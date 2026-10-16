import type {
  ClaimedOutboxEvent,
  OutboxRelayStore,
} from "@kanvas/database/runtime";
import { RuntimeFenceRejectedError } from "@kanvas/application";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import {
  ATTEMPT_DISPATCH_JOB,
  CONTENT_EVENT_JOB,
  OutboxRelay,
  PROVIDER_ATTEMPT_DISPATCH_JOB,
  WORKFLOW_CANCELLATION_JOB,
  WORKFLOW_WAKEUP_JOB,
} from "../src/outbox/outbox-relay.js";

describe("OutboxRelay", () => {
  it.each(["artifact.user_imported", "artifact.canvas_exported"] as const)(
    "routes durable %s notifications without an execution-generation fence",
    async (messageType) => {
      const event: ClaimedOutboxEvent = {
        id: "01K0000000000000000000000A",
        workspaceId: "01K00000000000000000000000",
        messageType,
        schemaVersion: 1,
        aggregateType: "artifact",
        aggregateId: "01K0000000000000000000000B",
        aggregateVersion: 1,
        publishAttempts: 1,
        payload: {
          artifactId: "01K0000000000000000000000B",
          storedObjectId: "01K0000000000000000000000C",
          uploadSessionId: "01K0000000000000000000000D",
          expectedGeneration: 7,
        },
      };
      const orchestrationAdd = vi.fn().mockResolvedValue(undefined);
      const assertRelayAllowed = vi.fn().mockResolvedValue(undefined);
      const relay = new OutboxRelay({
        store: {
          claimBatch: () => Promise.resolve([event]),
          markPublished: () => Promise.resolve(true),
          markQuarantined: () => Promise.resolve(true),
          markSuperseded: () => Promise.resolve(true),
          releaseForRetry: () => Promise.resolve(true),
        },
        queues: {
          orchestration: {
            add: orchestrationAdd,
          },
          execution: {
            add: vi.fn().mockResolvedValue(undefined),
          },
          providerExecution: {
            add: vi.fn().mockResolvedValue(undefined),
          },
        },
        logger: {
          warn: vi.fn(),
          error: vi.fn(),
        } as unknown as Logger,
        assertRelayAllowed,
        contentEventAttempts: 3,
        contentEventBackoffMs: 2_000,
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      });

      await expect(relay.runOnce()).resolves.toBe(1);
      expect(orchestrationAdd).toHaveBeenCalledWith(
        CONTENT_EVENT_JOB,
        expect.objectContaining({
          outboxEventId: event.id,
          artifactId: event.aggregateId,
          storedObjectId: "01K0000000000000000000000C",
          uploadSessionId: "01K0000000000000000000000D",
        }),
        expect.objectContaining({
          jobId: event.id,
          attempts: 3,
          backoff: { type: "exponential", delay: 2_000 },
        }),
      );
      expect(assertRelayAllowed).not.toHaveBeenCalled();
    },
  );

  it("publishes a claimed workflow wake-up with the outbox id as job id", async () => {
    const event: ClaimedOutboxEvent = {
      id: "01K00000000000000000000010",
      workspaceId: "01K00000000000000000000000",
      messageType: "workflow.wakeup.requested",
      schemaVersion: 1,
      aggregateType: "workflow_run",
      aggregateId: "01K00000000000000000000011",
      aggregateVersion: 1,
      publishAttempts: 1,
      payload: {
        workflowRunId: "01K00000000000000000000011",
        expectedGeneration: 7,
        outboxEventId: "spoofed-event",
        workspaceId: "spoofed-workspace",
        messageType: "spoofed.message",
        schemaVersion: 999,
        aggregateType: "spoofed_aggregate",
        aggregateId: "spoofed-aggregate-id",
        aggregateVersion: 999,
      },
    };
    const store: OutboxRelayStore = {
      claimBatch: () => Promise.resolve([event]),
      markPublished: () => Promise.resolve(true),
      markQuarantined: () => Promise.resolve(true),
      markSuperseded: () => Promise.resolve(true),
      releaseForRetry: () => Promise.resolve(true),
    };
    const add = vi.fn().mockResolvedValue(undefined);
    const relay = new OutboxRelay({
      store,
      queues: {
        orchestration: {
          add,
        },
        execution: {
          add: vi.fn().mockResolvedValue(undefined),
        },
        providerExecution: {
          add: vi.fn().mockResolvedValue(undefined),
        },
      },
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger,
      assertRelayAllowed: () => Promise.resolve(),
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });

    await expect(relay.runOnce()).resolves.toBe(1);
    expect(add).toHaveBeenCalledWith(
      WORKFLOW_WAKEUP_JOB,
      expect.objectContaining({
        outboxEventId: event.id,
        workspaceId: event.workspaceId,
        messageType: event.messageType,
        schemaVersion: event.schemaVersion,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        aggregateVersion: event.aggregateVersion,
        workflowRunId: event.aggregateId,
      }),
      expect.objectContaining({
        jobId: event.id,
      }),
    );
  });

  it("routes a terminal capability failure back to orchestration", async () => {
    const event: ClaimedOutboxEvent = {
      id: "01K00000000000000000000020",
      workspaceId: "01K00000000000000000000000",
      messageType: "capability.run.failed",
      schemaVersion: 1,
      aggregateType: "capability_run",
      aggregateId: "01K00000000000000000000021",
      aggregateVersion: 2,
      publishAttempts: 1,
      payload: {
        workflowRunId: "01K00000000000000000000022",
        nodeRunId: "01K00000000000000000000023",
        capabilityRunId: "01K00000000000000000000021",
        expectedGeneration: 7,
        cause: "unsafe_unknown_side_effect",
      },
    };
    const store: OutboxRelayStore = {
      claimBatch: () => Promise.resolve([event]),
      markPublished: () => Promise.resolve(true),
      markQuarantined: () => Promise.resolve(true),
      markSuperseded: () => Promise.resolve(true),
      releaseForRetry: () => Promise.resolve(true),
    };
    const orchestrationAdd = vi.fn().mockResolvedValue(undefined);
    const executionAdd = vi.fn().mockResolvedValue(undefined);
    const relay = new OutboxRelay({
      store,
      queues: {
        orchestration: {
          add: orchestrationAdd,
        },
        execution: {
          add: executionAdd,
        },
        providerExecution: {
          add: vi.fn().mockResolvedValue(undefined),
        },
      },
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger,
      assertRelayAllowed: () => Promise.resolve(),
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });

    await expect(relay.runOnce()).resolves.toBe(1);
    expect(orchestrationAdd).toHaveBeenCalledWith(
      WORKFLOW_WAKEUP_JOB,
      expect.objectContaining({
        messageType: "capability.run.failed",
        workflowRunId: "01K00000000000000000000022",
        capabilityRunId: event.aggregateId,
      }),
      expect.objectContaining({
        jobId: event.id,
      }),
    );
    expect(executionAdd).not.toHaveBeenCalled();
  });

  it.each([
    {
      messageType: "workflow.wakeup.requested",
      aggregateType: "workflow_deadline_schedule",
      aggregateId: "01K0000000000000000000002A",
      payload: {
        workflowRunId: "01K0000000000000000000002B",
        deadlineScheduleId: "01K0000000000000000000002A",
        expectedGeneration: 7,
      },
    },
    {
      messageType: "approval.decision.recorded",
      aggregateType: "workflow_approval_request",
      aggregateId: "01K0000000000000000000002C",
      payload: {
        workflowRunId: "01K0000000000000000000002D",
        nodeRunId: "01K0000000000000000000002E",
        approvalRequestId: "01K0000000000000000000002C",
        expectedGeneration: 7,
      },
    },
  ])(
    "routes bounded Workflow cause $messageType/$aggregateType to orchestration",
    async ({ messageType, aggregateType, aggregateId, payload }) => {
      const event: ClaimedOutboxEvent = {
        id: "01K0000000000000000000002F",
        workspaceId: "01K00000000000000000000000",
        messageType,
        schemaVersion: 1,
        aggregateType,
        aggregateId,
        aggregateVersion: 1,
        publishAttempts: 1,
        payload,
      };
      const orchestrationAdd = vi.fn().mockResolvedValue(undefined);
      const relay = new OutboxRelay({
        store: {
          claimBatch: () => Promise.resolve([event]),
          markPublished: () => Promise.resolve(true),
          markQuarantined: () => Promise.resolve(true),
          markSuperseded: () => Promise.resolve(true),
          releaseForRetry: () => Promise.resolve(true),
        },
        queues: {
          orchestration: {
            add: orchestrationAdd,
          },
          execution: {
            add: vi.fn().mockResolvedValue(undefined),
          },
          providerExecution: {
            add: vi.fn().mockResolvedValue(undefined),
          },
        },
        logger: {
          warn: vi.fn(),
          error: vi.fn(),
        } as unknown as Logger,
        assertRelayAllowed: () => Promise.resolve(),
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      });

      await expect(relay.runOnce()).resolves.toBe(1);
      expect(orchestrationAdd).toHaveBeenCalledWith(
        WORKFLOW_WAKEUP_JOB,
        expect.objectContaining({
          messageType,
          aggregateType,
          aggregateId,
          ...payload,
        }),
        expect.objectContaining({
          jobId: event.id,
        }),
      );
    },
  );

  it("fans a cancellation request out to orchestration and execution before publishing", async () => {
    const event: ClaimedOutboxEvent = {
      id: "01K00000000000000000000030",
      workspaceId: "01K00000000000000000000000",
      messageType: "workflow.cancel.requested",
      schemaVersion: 1,
      aggregateType: "workflow_run",
      aggregateId: "01K00000000000000000000031",
      aggregateVersion: 3,
      publishAttempts: 1,
      payload: {
        workflowRunId: "01K00000000000000000000031",
        expectedGeneration: 7,
        cause: "workflow_run.cancel_requested",
      },
    };
    const markPublished = vi.fn().mockResolvedValue(true);
    const store: OutboxRelayStore = {
      claimBatch: () => Promise.resolve([event]),
      markPublished,
      markQuarantined: () => Promise.resolve(true),
      markSuperseded: () => Promise.resolve(true),
      releaseForRetry: () => Promise.resolve(true),
    };
    const orchestrationAdd = vi.fn().mockResolvedValue(undefined);
    const executionAdd = vi.fn().mockResolvedValue(undefined);
    const assertRelayAllowed = vi.fn().mockResolvedValue(undefined);
    const relay = new OutboxRelay({
      store,
      queues: {
        orchestration: {
          add: orchestrationAdd,
        },
        execution: {
          add: executionAdd,
        },
        providerExecution: {
          add: vi.fn().mockResolvedValue(undefined),
        },
      },
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger,
      assertRelayAllowed,
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });

    await expect(relay.runOnce()).resolves.toBe(1);
    expect(orchestrationAdd).toHaveBeenCalledWith(
      WORKFLOW_WAKEUP_JOB,
      expect.objectContaining({
        messageType: "workflow.cancel.requested",
        workflowRunId: event.aggregateId,
      }),
      expect.objectContaining({
        jobId: event.id,
      }),
    );
    expect(executionAdd).toHaveBeenCalledWith(
      WORKFLOW_CANCELLATION_JOB,
      expect.objectContaining({
        messageType: "workflow.cancel.requested",
        workflowRunId: event.aggregateId,
      }),
      expect.objectContaining({
        jobId: event.id,
      }),
    );
    expect(assertRelayAllowed).toHaveBeenCalledWith(
      7,
      "workflow.cancel.requested",
    );
    expect(markPublished).toHaveBeenCalledOnce();
  });

  it("quarantines one malformed payload and still publishes the next claimed event", async () => {
    const malformed: ClaimedOutboxEvent = {
      id: "01K00000000000000000000040",
      workspaceId: "01K00000000000000000000000",
      messageType: "workflow.wakeup.requested",
      schemaVersion: 1,
      aggregateType: "workflow_run",
      aggregateId: "01K00000000000000000000041",
      aggregateVersion: 1,
      publishAttempts: 1,
      payload: "{not-json",
    };
    const valid: ClaimedOutboxEvent = {
      id: "01K00000000000000000000042",
      workspaceId: "01K00000000000000000000000",
      messageType: "workflow.wakeup.requested",
      schemaVersion: 1,
      aggregateType: "workflow_run",
      aggregateId: "01K00000000000000000000043",
      aggregateVersion: 1,
      publishAttempts: 1,
      payload: JSON.stringify({
        workflowRunId: "01K00000000000000000000043",
        expectedGeneration: 7,
      }),
    };
    const markPublished = vi.fn().mockResolvedValue(true);
    const markQuarantined = vi.fn().mockResolvedValue(true);
    const releaseForRetry = vi.fn().mockResolvedValue(true);
    const orchestrationAdd = vi.fn().mockResolvedValue(undefined);
    const relay = new OutboxRelay({
      store: {
        claimBatch: () => Promise.resolve([malformed, valid]),
        markPublished,
        markQuarantined,
        markSuperseded: () => Promise.resolve(true),
        releaseForRetry,
      },
      queues: {
        orchestration: {
          add: orchestrationAdd,
        },
        execution: {
          add: vi.fn().mockResolvedValue(undefined),
        },
        providerExecution: {
          add: vi.fn().mockResolvedValue(undefined),
        },
      },
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger,
      assertRelayAllowed: () => Promise.resolve(),
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });

    await expect(relay.runOnce()).resolves.toBe(2);
    expect(markQuarantined).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: malformed.id,
        errorCode: "outbox.invalid_payload",
      }),
    );
    expect(releaseForRetry).not.toHaveBeenCalled();
    expect(orchestrationAdd).toHaveBeenCalledOnce();
    expect(orchestrationAdd).toHaveBeenCalledWith(
      WORKFLOW_WAKEUP_JOB,
      expect.objectContaining({
        outboxEventId: valid.id,
        workflowRunId: valid.aggregateId,
      }),
      expect.objectContaining({
        jobId: valid.id,
      }),
    );
    expect(markPublished).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: valid.id,
      }),
    );
  });

  it.each([
    {
      name: "unsupported schema",
      patch: {
        schemaVersion: 2,
      },
      errorCode: "outbox.unsupported_schema_version",
    },
    {
      name: "unsupported route",
      patch: {
        messageType: "workflow.unknown",
      },
      errorCode: "outbox.unsupported_message_type",
    },
    {
      name: "invalid envelope",
      patch: {
        aggregateVersion: 0,
      },
      errorCode: "outbox.invalid_envelope",
    },
    {
      name: "mismatched aggregate",
      patch: {
        aggregateType: "capability_run",
      },
      errorCode: "outbox.mismatched_aggregate",
    },
    {
      name: "invalid expected generation",
      patch: {
        payload: {
          workflowRunId: "01K00000000000000000000051",
          expectedGeneration: 0,
        },
      },
      errorCode: "outbox.invalid_expected_generation",
    },
  ])(
    "quarantines a deterministic $name error",
    async ({ patch, errorCode }) => {
      const event: ClaimedOutboxEvent = {
        id: "01K00000000000000000000050",
        workspaceId: "01K00000000000000000000000",
        messageType: "workflow.wakeup.requested",
        schemaVersion: 1,
        aggregateType: "workflow_run",
        aggregateId: "01K00000000000000000000051",
        aggregateVersion: 1,
        publishAttempts: 1,
        payload: {
          workflowRunId: "01K00000000000000000000051",
          expectedGeneration: 7,
        },
        ...patch,
      };
      const markQuarantined = vi.fn().mockResolvedValue(true);
      const releaseForRetry = vi.fn().mockResolvedValue(true);
      const add = vi.fn().mockResolvedValue(undefined);
      const relay = new OutboxRelay({
        store: {
          claimBatch: () => Promise.resolve([event]),
          markPublished: () => Promise.resolve(true),
          markQuarantined,
          markSuperseded: () => Promise.resolve(true),
          releaseForRetry,
        },
        queues: {
          orchestration: {
            add,
          },
          execution: {
            add,
          },
          providerExecution: {
            add,
          },
        },
        logger: {
          warn: vi.fn(),
          error: vi.fn(),
        } as unknown as Logger,
        assertRelayAllowed: () => Promise.resolve(),
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      });

      await expect(relay.runOnce()).resolves.toBe(1);
      expect(markQuarantined).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: event.id,
          errorCode,
        }),
      );
      expect(releaseForRetry).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    },
  );

  it("releases runtime-fence failures for retry instead of quarantining them", async () => {
    const event: ClaimedOutboxEvent = {
      id: "01K00000000000000000000060",
      workspaceId: "01K00000000000000000000000",
      messageType: "workflow.wakeup.requested",
      schemaVersion: 1,
      aggregateType: "workflow_run",
      aggregateId: "01K00000000000000000000061",
      aggregateVersion: 1,
      publishAttempts: 1,
      payload: {
        workflowRunId: "01K00000000000000000000061",
        expectedGeneration: 7,
      },
    };
    const markQuarantined = vi.fn().mockResolvedValue(true);
    const releaseForRetry = vi.fn().mockResolvedValue(true);
    const relay = new OutboxRelay({
      store: {
        claimBatch: () => Promise.resolve([event]),
        markPublished: () => Promise.resolve(true),
        markQuarantined,
        markSuperseded: () => Promise.resolve(true),
        releaseForRetry,
      },
      queues: {
        orchestration: {
          add: vi.fn().mockResolvedValue(undefined),
        },
        execution: {
          add: vi.fn().mockResolvedValue(undefined),
        },
        providerExecution: {
          add: vi.fn().mockResolvedValue(undefined),
        },
      },
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger,
      assertRelayAllowed: () =>
        Promise.reject(new Error("Runtime fence temporarily closed.")),
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });

    await expect(relay.runOnce()).resolves.toBe(1);
    expect(releaseForRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: event.id,
        availableAt: new Date("2026-07-27T12:00:01.000Z"),
      }),
    );
    expect(markQuarantined).not.toHaveBeenCalled();
  });

  it("supersedes a stale-generation event so reconciliation can rebuild it", async () => {
    const event: ClaimedOutboxEvent = {
      id: "01K00000000000000000000065",
      workspaceId: "01K00000000000000000000000",
      messageType: "workflow.wakeup.requested",
      schemaVersion: 1,
      aggregateType: "workflow_run",
      aggregateId: "01K00000000000000000000066",
      aggregateVersion: 1,
      publishAttempts: 1,
      payload: {
        workflowRunId: "01K00000000000000000000066",
        expectedGeneration: 7,
      },
    };
    const markSuperseded = vi.fn().mockResolvedValue(true);
    const releaseForRetry = vi.fn().mockResolvedValue(true);
    const relay = new OutboxRelay({
      store: {
        claimBatch: () => Promise.resolve([event]),
        markPublished: () => Promise.resolve(true),
        markQuarantined: () => Promise.resolve(true),
        markSuperseded,
        releaseForRetry,
      },
      queues: {
        orchestration: {
          add: vi.fn().mockResolvedValue(undefined),
        },
        execution: {
          add: vi.fn().mockResolvedValue(undefined),
        },
        providerExecution: {
          add: vi.fn().mockResolvedValue(undefined),
        },
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger,
      assertRelayAllowed: () =>
        Promise.reject(
          new RuntimeFenceRejectedError(
            "relay",
            "ACTIVE",
            "stale_execution_generation",
            "Execution generation is stale.",
          ),
        ),
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });

    await expect(relay.runOnce()).resolves.toBe(1);
    expect(markSuperseded).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: event.id,
        errorCode: "outbox.stale_execution_generation",
        supersededAt: new Date("2026-07-27T12:00:00.000Z"),
      }),
    );
    expect(releaseForRetry).not.toHaveBeenCalled();
  });

  it("releases queue transport failures for retry instead of quarantining them", async () => {
    const event: ClaimedOutboxEvent = {
      id: "01K00000000000000000000070",
      workspaceId: "01K00000000000000000000000",
      messageType: "attempt.dispatch.requested",
      schemaVersion: 1,
      aggregateType: "capability_attempt",
      aggregateId: "01K00000000000000000000071",
      aggregateVersion: 1,
      publishAttempts: 1,
      payload: {
        workflowRunId: "01K00000000000000000000072",
        nodeRunId: "01K00000000000000000000073",
        capabilityRunId: "01K00000000000000000000074",
        attemptId: "01K00000000000000000000071",
        executionTarget: "worker",
        expectedGeneration: 7,
      },
    };
    const markQuarantined = vi.fn().mockResolvedValue(true);
    const releaseForRetry = vi.fn().mockResolvedValue(true);
    const relay = new OutboxRelay({
      store: {
        claimBatch: () => Promise.resolve([event]),
        markPublished: () => Promise.resolve(true),
        markQuarantined,
        markSuperseded: () => Promise.resolve(true),
        releaseForRetry,
      },
      queues: {
        orchestration: {
          add: vi.fn().mockResolvedValue(undefined),
        },
        execution: {
          add: vi.fn().mockRejectedValue(new Error("Redis unavailable.")),
        },
        providerExecution: {
          add: vi.fn().mockResolvedValue(undefined),
        },
      },
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger,
      assertRelayAllowed: () => Promise.resolve(),
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });

    await expect(relay.runOnce()).resolves.toBe(1);
    expect(releaseForRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: event.id,
      }),
    );
    expect(markQuarantined).not.toHaveBeenCalled();
  });

  it.each([
    {
      executionTarget: "worker" as const,
      expectedJob: ATTEMPT_DISPATCH_JOB,
      expectedQueue: "execution" as const,
    },
    {
      executionTarget: "provider" as const,
      expectedJob: PROVIDER_ATTEMPT_DISPATCH_JOB,
      expectedQueue: "providerExecution" as const,
    },
  ])(
    "routes $executionTarget dispatches only to $expectedQueue",
    async ({ executionTarget, expectedJob, expectedQueue }) => {
      const event: ClaimedOutboxEvent = {
        id:
          executionTarget === "worker"
            ? "01K00000000000000000000080"
            : "01K00000000000000000000081",
        workspaceId: "01K00000000000000000000000",
        messageType: "attempt.dispatch.requested",
        schemaVersion: 1,
        aggregateType: "capability_attempt",
        aggregateId: "01K00000000000000000000082",
        aggregateVersion: 1,
        publishAttempts: 1,
        payload: {
          workflowRunId: "01K00000000000000000000083",
          nodeRunId: "01K00000000000000000000084",
          capabilityRunId: "01K00000000000000000000085",
          attemptId: "01K00000000000000000000082",
          expectedGeneration: 7,
          executionTarget,
          queue: "spoofed-queue",
          jobName: "spoofed-job",
        },
      };
      const orchestrationAdd = vi.fn().mockResolvedValue(undefined);
      const executionAdd = vi.fn().mockResolvedValue(undefined);
      const providerExecutionAdd = vi.fn().mockResolvedValue(undefined);
      const relay = new OutboxRelay({
        store: {
          claimBatch: () => Promise.resolve([event]),
          markPublished: () => Promise.resolve(true),
          markQuarantined: () => Promise.resolve(true),
          markSuperseded: () => Promise.resolve(true),
          releaseForRetry: () => Promise.resolve(true),
        },
        queues: {
          orchestration: {
            add: orchestrationAdd,
          },
          execution: {
            add: executionAdd,
          },
          providerExecution: {
            add: providerExecutionAdd,
          },
        },
        logger: {
          warn: vi.fn(),
          error: vi.fn(),
        } as unknown as Logger,
        assertRelayAllowed: () => Promise.resolve(),
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      });

      await expect(relay.runOnce()).resolves.toBe(1);
      const expectedAdd =
        expectedQueue === "execution" ? executionAdd : providerExecutionAdd;
      const otherAdd =
        expectedQueue === "execution" ? providerExecutionAdd : executionAdd;
      expect(expectedAdd).toHaveBeenCalledWith(
        expectedJob,
        expect.objectContaining({
          executionTarget,
          outboxEventId: event.id,
          attemptId: event.aggregateId,
        }),
        expect.objectContaining({
          jobId: event.id,
        }),
      );
      expect(otherAdd).not.toHaveBeenCalled();
      expect(orchestrationAdd).not.toHaveBeenCalled();
    },
  );

  it("routes a legacy dispatch without executionTarget to the worker queue", async () => {
    const event: ClaimedOutboxEvent = {
      id: "01K00000000000000000000086",
      workspaceId: "01K00000000000000000000000",
      messageType: "attempt.dispatch.requested",
      schemaVersion: 1,
      aggregateType: "capability_attempt",
      aggregateId: "01K00000000000000000000087",
      aggregateVersion: 1,
      publishAttempts: 1,
      payload: {
        workflowRunId: "01K00000000000000000000088",
        nodeRunId: "01K00000000000000000000089",
        capabilityRunId: "01K0000000000000000000008A",
        attemptId: "01K00000000000000000000087",
        expectedGeneration: 7,
      },
    };
    const executionAdd = vi.fn().mockResolvedValue(undefined);
    const providerExecutionAdd = vi.fn().mockResolvedValue(undefined);
    const relay = new OutboxRelay({
      store: {
        claimBatch: () => Promise.resolve([event]),
        markPublished: () => Promise.resolve(true),
        markQuarantined: () => Promise.resolve(true),
        markSuperseded: () => Promise.resolve(true),
        releaseForRetry: () => Promise.resolve(true),
      },
      queues: {
        orchestration: {
          add: vi.fn().mockResolvedValue(undefined),
        },
        execution: {
          add: executionAdd,
        },
        providerExecution: {
          add: providerExecutionAdd,
        },
      },
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger,
      assertRelayAllowed: () => Promise.resolve(),
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });

    await expect(relay.runOnce()).resolves.toBe(1);
    expect(executionAdd).toHaveBeenCalledWith(
      ATTEMPT_DISPATCH_JOB,
      expect.objectContaining({
        executionTarget: "worker",
      }),
      expect.any(Object),
    );
    expect(providerExecutionAdd).not.toHaveBeenCalled();
  });

  it.each(["browser", "invalid-target"])(
    "quarantines non-queue execution target %s",
    async (executionTarget) => {
      const event: ClaimedOutboxEvent = {
        id: "01K00000000000000000000090",
        workspaceId: "01K00000000000000000000000",
        messageType: "attempt.dispatch.requested",
        schemaVersion: 1,
        aggregateType: "capability_attempt",
        aggregateId: "01K00000000000000000000091",
        aggregateVersion: 1,
        publishAttempts: 1,
        payload: {
          workflowRunId: "01K00000000000000000000092",
          nodeRunId: "01K00000000000000000000093",
          capabilityRunId: "01K00000000000000000000094",
          attemptId: "01K00000000000000000000091",
          expectedGeneration: 7,
          executionTarget,
        },
      };
      const markQuarantined = vi.fn().mockResolvedValue(true);
      const add = vi.fn().mockResolvedValue(undefined);
      const relay = new OutboxRelay({
        store: {
          claimBatch: () => Promise.resolve([event]),
          markPublished: () => Promise.resolve(true),
          markQuarantined,
          markSuperseded: () => Promise.resolve(true),
          releaseForRetry: () => Promise.resolve(true),
        },
        queues: {
          orchestration: {
            add,
          },
          execution: {
            add,
          },
          providerExecution: {
            add,
          },
        },
        logger: {
          warn: vi.fn(),
          error: vi.fn(),
        } as unknown as Logger,
        assertRelayAllowed: () => Promise.resolve(),
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      });

      await expect(relay.runOnce()).resolves.toBe(1);
      expect(markQuarantined).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: event.id,
          errorCode: "outbox.invalid_execution_target",
        }),
      );
      expect(add).not.toHaveBeenCalled();
    },
  );
});
