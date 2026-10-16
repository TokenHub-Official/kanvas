import { describe, expect, it } from "vitest";

import {
  INBOX_CONSUMER_NAMES,
  INBOX_JOB_NAMES,
  PermanentInboxDeliveryError,
  isPermanentInboxDeliveryError,
  parseAttemptDispatchDelivery,
  parseContentEventDelivery,
  parseInboxDelivery,
  parseWorkflowCancellationDelivery,
  parseWorkflowOrchestrationDelivery,
  type PermanentInboxDeliveryErrorCode,
} from "../src/queue/inbox-delivery.js";

const ids = Object.freeze({
  workspace: "01K00000000000000000000000",
  event: "01K00000000000000000000001",
  workflowRun: "01K00000000000000000000002",
  nodeRun: "01K00000000000000000000003",
  capabilityRun: "01K00000000000000000000004",
  attempt: "01K00000000000000000000005",
  other: "01K00000000000000000000006",
  deadline: "01K00000000000000000000007",
  approval: "01K00000000000000000000008",
  artifact: "01K00000000000000000000009",
  storedObject: "01K0000000000000000000000A",
  uploadSession: "01K0000000000000000000000B",
});

function queueEnvelope(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    outboxEventId: ids.event,
    workspaceId: ids.workspace,
    messageType: "workflow.wakeup.requested",
    aggregateType: "workflow_run",
    aggregateId: ids.workflowRun,
    aggregateVersion: 2,
    expectedGeneration: 7,
    workflowRunId: ids.workflowRun,
    ...overrides,
  };
}

function expectPermanentCode(
  operation: () => unknown,
  code: PermanentInboxDeliveryErrorCode,
): void {
  try {
    operation();
  } catch (error) {
    expect(isPermanentInboxDeliveryError(error)).toBe(true);
    expect(error).toBeInstanceOf(PermanentInboxDeliveryError);
    expect((error as PermanentInboxDeliveryError).code).toBe(code);
    expect((error as Error).message).toBe(code);
    return;
  }
  throw new Error(`Expected permanent delivery error ${code}.`);
}

describe("Inbox queue delivery protocol", () => {
  it("parses a complete workflow envelope into trusted delivery metadata", () => {
    const result = parseWorkflowOrchestrationDelivery(
      queueEnvelope({
        ignoredProducerDetail: "never exposed to the processor contract",
      }),
    );

    expect(result).toEqual({
      jobName: INBOX_JOB_NAMES.workflowOrchestration,
      delivery: {
        consumerName: INBOX_CONSUMER_NAMES.workflowOrchestration,
        eventId: ids.event,
        workspaceId: ids.workspace,
        schemaVersion: 1,
        messageType: "workflow.wakeup.requested",
        aggregateType: "workflow_run",
        aggregateId: ids.workflowRun,
        aggregateVersion: 2,
        expectedGeneration: 7,
      },
      payload: {
        messageType: "workflow.wakeup.requested",
        workflowRunId: ids.workflowRun,
        expectedGeneration: 7,
      },
    });
    expect(result).not.toHaveProperty("ignoredProducerDetail");
    expect(result.payload).not.toHaveProperty("ignoredProducerDetail");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.delivery)).toBe(true);
    expect(Object.isFrozen(result.payload)).toBe(true);
  });

  it.each([
    "capability.run.completed",
    "capability.run.failed",
    "capability.run.cancelled",
  ] as const)(
    "allows %s only as a capability_run event matching capabilityRunId",
    (messageType) => {
      const result = parseWorkflowOrchestrationDelivery(
        queueEnvelope({
          messageType,
          aggregateType: "capability_run",
          aggregateId: ids.capabilityRun,
          nodeRunId: ids.nodeRun,
          capabilityRunId: ids.capabilityRun,
        }),
      );

      expect(result.delivery).toMatchObject({
        consumerName: INBOX_CONSUMER_NAMES.workflowOrchestration,
        messageType,
        aggregateType: "capability_run",
        aggregateId: ids.capabilityRun,
      });
      expect(result.payload).toEqual({
        messageType,
        workflowRunId: ids.workflowRun,
        nodeRunId: ids.nodeRun,
        capabilityRunId: ids.capabilityRun,
        expectedGeneration: 7,
      });
    },
  );

  it("parses deadline and approval causes with their own aggregate identities", () => {
    const deadline = parseWorkflowOrchestrationDelivery(
      queueEnvelope({
        aggregateType: "workflow_deadline_schedule",
        aggregateId: ids.deadline,
        deadlineScheduleId: ids.deadline,
      }),
    );
    expect(deadline.delivery).toMatchObject({
      messageType: "workflow.wakeup.requested",
      aggregateType: "workflow_deadline_schedule",
      aggregateId: ids.deadline,
    });
    expect(deadline.payload).toEqual({
      messageType: "workflow.wakeup.requested",
      workflowRunId: ids.workflowRun,
      deadlineScheduleId: ids.deadline,
      expectedGeneration: 7,
    });

    const approval = parseWorkflowOrchestrationDelivery(
      queueEnvelope({
        messageType: "approval.decision.recorded",
        aggregateType: "workflow_approval_request",
        aggregateId: ids.approval,
        nodeRunId: ids.nodeRun,
        approvalRequestId: ids.approval,
      }),
    );
    expect(approval.delivery).toMatchObject({
      messageType: "approval.decision.recorded",
      aggregateType: "workflow_approval_request",
      aggregateId: ids.approval,
    });
    expect(approval.payload).toEqual({
      messageType: "approval.decision.recorded",
      workflowRunId: ids.workflowRun,
      nodeRunId: ids.nodeRun,
      approvalRequestId: ids.approval,
      expectedGeneration: 7,
    });
  });

  it("parses attempt dispatch only for the matching capability_attempt", () => {
    const result = parseAttemptDispatchDelivery(
      queueEnvelope({
        messageType: "attempt.dispatch.requested",
        aggregateType: "capability_attempt",
        aggregateId: ids.attempt,
        nodeRunId: ids.nodeRun,
        capabilityRunId: ids.capabilityRun,
        attemptId: ids.attempt,
        executionTarget: "worker",
      }),
    );

    expect(result).toEqual({
      jobName: INBOX_JOB_NAMES.attemptDispatch,
      delivery: {
        consumerName: INBOX_CONSUMER_NAMES.attemptDispatch,
        eventId: ids.event,
        workspaceId: ids.workspace,
        schemaVersion: 1,
        messageType: "attempt.dispatch.requested",
        aggregateType: "capability_attempt",
        aggregateId: ids.attempt,
        aggregateVersion: 2,
        expectedGeneration: 7,
      },
      payload: {
        messageType: "attempt.dispatch.requested",
        invocationKind: "workflow",
        workflowRunId: ids.workflowRun,
        nodeRunId: ids.nodeRun,
        capabilityRunId: ids.capabilityRun,
        attemptId: ids.attempt,
        executionTarget: "worker",
        expectedGeneration: 7,
      },
    });
  });

  it("parses a direct user capability dispatch without workflow identity", () => {
    const result = parseAttemptDispatchDelivery(
      queueEnvelope({
        messageType: "attempt.dispatch.requested",
        aggregateType: "capability_attempt",
        aggregateId: ids.attempt,
        workflowRunId: undefined,
        invocationKind: "user",
        capabilityRunId: ids.capabilityRun,
        attemptId: ids.attempt,
        executionTarget: "provider",
      }),
      "provider",
    );

    expect(result.payload).toMatchObject({
      invocationKind: "user",
      capabilityRunId: ids.capabilityRun,
      attemptId: ids.attempt,
      executionTarget: "provider",
    });
    expect(result.payload).not.toHaveProperty("workflowRunId");
    expect(result.payload).not.toHaveProperty("nodeRunId");
  });

  it("gives cancellation fan-out independent stable consumer identities", () => {
    const value = queueEnvelope({
      messageType: "workflow.cancel.requested",
    });

    const orchestration = parseWorkflowOrchestrationDelivery(value);
    const execution = parseWorkflowCancellationDelivery(value);

    expect(orchestration.delivery.eventId).toBe(execution.delivery.eventId);
    expect(orchestration.delivery.consumerName).toBe(
      INBOX_CONSUMER_NAMES.workflowOrchestration,
    );
    expect(execution.delivery.consumerName).toBe(
      INBOX_CONSUMER_NAMES.workflowCancellation,
    );
    expect(orchestration.delivery.consumerName).not.toBe(
      execution.delivery.consumerName,
    );
  });

  it("dispatches the generic parser by its exact job allowlist", () => {
    const result = parseInboxDelivery(
      INBOX_JOB_NAMES.attemptDispatch,
      queueEnvelope({
        messageType: "attempt.dispatch.requested",
        aggregateType: "capability_attempt",
        aggregateId: ids.attempt,
        nodeRunId: ids.nodeRun,
        capabilityRunId: ids.capabilityRun,
        attemptId: ids.attempt,
        executionTarget: "worker",
      }),
    );

    expect(result.jobName).toBe(INBOX_JOB_NAMES.attemptDispatch);
    expect(result.delivery.consumerName).toBe(
      INBOX_CONSUMER_NAMES.attemptDispatch,
    );
  });

  it.each(["artifact.user_imported", "artifact.canvas_exported"] as const)(
    "parses the %s event with exact durable identities",
    (messageType) => {
      const result = parseContentEventDelivery(
        queueEnvelope({
          messageType,
          aggregateType: "artifact",
          aggregateId: ids.artifact,
          artifactId: ids.artifact,
          storedObjectId: ids.storedObject,
          uploadSessionId: ids.uploadSession,
        }),
      );

      expect(result).toEqual({
        jobName: INBOX_JOB_NAMES.contentEvent,
        delivery: {
          consumerName: INBOX_CONSUMER_NAMES.contentEvent,
          eventId: ids.event,
          workspaceId: ids.workspace,
          schemaVersion: 1,
          messageType,
          aggregateType: "artifact",
          aggregateId: ids.artifact,
          aggregateVersion: 2,
          expectedGeneration: 7,
        },
        payload: {
          messageType,
          artifactId: ids.artifact,
          storedObjectId: ids.storedObject,
          uploadSessionId: ids.uploadSession,
          expectedGeneration: 7,
        },
      });
      expect(
        parseInboxDelivery(
          INBOX_JOB_NAMES.contentEvent,
          queueEnvelope({
            messageType,
            aggregateType: "artifact",
            aggregateId: ids.artifact,
            artifactId: ids.artifact,
            storedObjectId: ids.storedObject,
            uploadSessionId: ids.uploadSession,
          }),
        ).delivery.consumerName,
      ).toBe(INBOX_CONSUMER_NAMES.contentEvent);
    },
  );

  it("parses provider dispatch only for the provider job identity", () => {
    const value = queueEnvelope({
      messageType: "attempt.dispatch.requested",
      aggregateType: "capability_attempt",
      aggregateId: ids.attempt,
      nodeRunId: ids.nodeRun,
      capabilityRunId: ids.capabilityRun,
      attemptId: ids.attempt,
      executionTarget: "provider",
    });
    const result = parseInboxDelivery(
      INBOX_JOB_NAMES.providerAttemptDispatch,
      value,
    );

    expect(result.jobName).toBe(INBOX_JOB_NAMES.providerAttemptDispatch);
    expect(result.delivery.consumerName).toBe(
      INBOX_CONSUMER_NAMES.providerAttemptDispatch,
    );
    expect(result.payload).toMatchObject({
      attemptId: ids.attempt,
      executionTarget: "provider",
    });
  });

  it.each([
    {
      name: "provider payload on the worker job",
      jobName: INBOX_JOB_NAMES.attemptDispatch,
      executionTarget: "provider",
      code: "delivery.job_target_mismatch",
    },
    {
      name: "worker payload on the provider job",
      jobName: INBOX_JOB_NAMES.providerAttemptDispatch,
      executionTarget: "worker",
      code: "delivery.job_target_mismatch",
    },
    {
      name: "missing target on the provider job",
      jobName: INBOX_JOB_NAMES.providerAttemptDispatch,
      executionTarget: undefined,
      code: "delivery.execution_target_invalid",
    },
    {
      name: "missing target on the worker job",
      jobName: INBOX_JOB_NAMES.attemptDispatch,
      executionTarget: undefined,
      code: "delivery.execution_target_invalid",
    },
    {
      name: "browser payload on any queue job",
      jobName: INBOX_JOB_NAMES.attemptDispatch,
      executionTarget: "browser",
      code: "delivery.execution_target_invalid",
    },
  ] as const)("rejects $name", ({ jobName, executionTarget, code }) => {
    expectPermanentCode(
      () =>
        parseInboxDelivery(
          jobName,
          queueEnvelope({
            messageType: "attempt.dispatch.requested",
            aggregateType: "capability_attempt",
            aggregateId: ids.attempt,
            nodeRunId: ids.nodeRun,
            capabilityRunId: ids.capabilityRun,
            attemptId: ids.attempt,
            executionTarget,
          }),
        ),
      code,
    );
  });

  it.each([
    {
      value: null,
      code: "delivery.payload_not_object",
    },
    {
      value: queueEnvelope({ schemaVersion: 2 }),
      code: "delivery.schema_version_unsupported",
    },
    {
      value: queueEnvelope({ outboxEventId: "not-an-ulid" }),
      code: "delivery.event_id_invalid",
    },
    {
      value: queueEnvelope({ workspaceId: ids.workspace.toLowerCase() }),
      code: "delivery.workspace_id_invalid",
    },
    {
      value: queueEnvelope({ messageType: 42 }),
      code: "delivery.message_type_invalid",
    },
    {
      value: queueEnvelope({ aggregateType: null }),
      code: "delivery.aggregate_type_invalid",
    },
    {
      value: queueEnvelope({ aggregateId: "" }),
      code: "delivery.aggregate_id_invalid",
    },
    {
      value: queueEnvelope({ aggregateVersion: 0 }),
      code: "delivery.aggregate_version_invalid",
    },
    {
      value: queueEnvelope({ expectedGeneration: 1.5 }),
      code: "delivery.expected_generation_invalid",
    },
    {
      value: queueEnvelope({ workflowRunId: "invalid" }),
      code: "delivery.payload_identity_invalid",
    },
  ] as const)(
    "rejects malformed envelope facts with $code",
    ({ value, code }) => {
      expectPermanentCode(
        () => parseWorkflowOrchestrationDelivery(value),
        code,
      );
    },
  );

  it("rejects unsupported jobs without inspecting or exposing their payload", () => {
    const secret = "provider-secret-that-must-not-leak";
    try {
      parseInboxDelivery("unknown-job", {
        secret,
      });
    } catch (error) {
      expectPermanentCode(() => {
        throw error;
      }, "delivery.job_unsupported");
      expect(String(error)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(error).not.toHaveProperty("payload");
      return;
    }
    throw new Error("Expected unsupported job to be rejected.");
  });

  it("rejects a valid message delivered through the wrong job", () => {
    expectPermanentCode(
      () =>
        parseAttemptDispatchDelivery(
          queueEnvelope({
            messageType: "workflow.cancel.requested",
          }),
        ),
      "delivery.message_job_mismatch",
    );
  });

  it("rejects a message paired with the wrong aggregate type", () => {
    expectPermanentCode(
      () =>
        parseWorkflowOrchestrationDelivery(
          queueEnvelope({
            aggregateType: "capability_run",
          }),
        ),
      "delivery.message_aggregate_mismatch",
    );
  });

  it.each([
    {
      parse: () =>
        parseWorkflowOrchestrationDelivery(
          queueEnvelope({
            aggregateId: ids.other,
          }),
        ),
    },
    {
      parse: () =>
        parseWorkflowOrchestrationDelivery(
          queueEnvelope({
            messageType: "capability.run.completed",
            aggregateType: "capability_run",
            aggregateId: ids.other,
            nodeRunId: ids.nodeRun,
            capabilityRunId: ids.capabilityRun,
          }),
        ),
    },
    {
      parse: () =>
        parseAttemptDispatchDelivery(
          queueEnvelope({
            messageType: "attempt.dispatch.requested",
            aggregateType: "capability_attempt",
            aggregateId: ids.other,
            nodeRunId: ids.nodeRun,
            capabilityRunId: ids.capabilityRun,
            attemptId: ids.attempt,
            executionTarget: "worker",
          }),
        ),
    },
  ])("rejects aggregate identity spoofing", ({ parse }) => {
    expectPermanentCode(parse, "delivery.aggregate_identity_mismatch");
  });
});
