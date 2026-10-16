import { createHash } from "node:crypto";

import type { ApplicationRuntime } from "@kanvas/application";
import type { StoragePort } from "@kanvas/application";
import {
  AttemptFailureStoreError,
  AtomicAttemptCompletionStoreError,
  type AttemptFailureStore,
  type AtomicAttemptCompletionStore,
  type BoundedWorkflowOrchestratorStore,
  type ReportAttemptFailureOptions,
  type StorageUploadStore,
  type UploadSessionRecord,
  type WorkflowEngineStore,
} from "@kanvas/database/runtime";
import {
  verifyTrustedImage,
  type TrustedImageStorageRuntime,
} from "@kanvas/storage";
import { describe, expect, it, vi } from "vitest";

import {
  AttemptDispatchProcessor,
  WorkflowCancellationProcessor,
  WorkflowWakeupProcessor,
} from "../src/queue/workflow-execution.processors.js";
import type { WorkerAdapterExecutionContext } from "../src/adapter/worker-adapter.js";
import { createWorkerAdapterRegistry } from "../src/adapter/worker-adapter.js";
import type { MaterializeWorkerAttemptOutputsRequest } from "../src/storage/worker-attempt-output-materializer.js";
import { createWorkerAttemptOutputMaterializer } from "../src/storage/worker-attempt-output-materializer.js";
import type {
  WorkerInputArtifactAccess,
  WorkerInputArtifactResolver,
} from "../src/storage/worker-input-artifact-resolver.js";
import { createWorkerInputArtifactResolver } from "../src/storage/worker-input-artifact-resolver.js";
import { AttemptLeaseLostError } from "../src/queue/attempt-heartbeat.js";
import { PermanentInboxDeliveryError } from "../src/queue/inbox-delivery.js";
import { AdapterFailure } from "../src/queue/worker-adapter-failure.js";
import {
  createDeterministicRgbaPng,
  deterministicImageDerivedPngAdapter,
  deterministicImageDerivedPngAdapterKey,
} from "./support/deterministic-image-derived-png-adapter.js";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function ulid(suffix: string): string {
  return `01J${"0".repeat(23 - suffix.length)}${suffix}`;
}

const ids = Object.freeze({
  workspace: ulid("1"),
  actor: ulid("24"),
  workflowRun: ulid("2"),
  nodeRun: ulid("3"),
  capabilityRun: ulid("4"),
  attempt: ulid("5"),
  wakeupEvent: ulid("6"),
  dispatchEvent: ulid("7"),
  terminalEvent: ulid("8"),
  cancelEvent: ulid("9"),
  generatedCapabilityRun: ulid("10"),
  generatedAttempt: ulid("11"),
  dispatchOutbox: ulid("12"),
  completion: ulid("13"),
  completionOutbox: ulid("14"),
  cancellationOutbox: ulid("15"),
  binding: ulid("16"),
  implementation: ulid("17"),
  failureNextAttempt: ulid("18"),
  failureOutbox: ulid("19"),
  approval: ulid("20"),
  approvalEvent: ulid("21"),
  deadlineSchedule: ulid("22"),
  deadlineEvent: ulid("23"),
  runtimeAdapterRevision: ulid("25"),
});

const IMPLEMENTATION_DIGEST = `sha256:${"a".repeat(64)}`;
const RUNTIME_ADAPTER_DIGEST = `sha256:${"c".repeat(64)}`;
const EXECUTION_DEADLINE = new Date("2026-07-27T12:05:00.000Z");
const IDENTITY_INPUT_MAPPING = Object.freeze({
  schemaVersion: "kanvas.compiled-capability-mapping/v1" as const,
  direction: "input" as const,
  expression: Object.freeze({
    op: "source" as const,
    root: "input" as const,
    path: Object.freeze([]),
  }),
});
const IDENTITY_OUTPUT_MAPPING = Object.freeze({
  schemaVersion: "kanvas.compiled-capability-mapping/v1" as const,
  direction: "output" as const,
  expression: Object.freeze({
    op: "source" as const,
    root: "result" as const,
    path: Object.freeze([]),
  }),
});

function runtimeAdapter(adapterKey: string) {
  return Object.freeze({
    schemaVersion: "kanvas.runtime-adapter-definition/v1" as const,
    adapterKey,
    revision: 1,
    displayName: Object.freeze({
      defaultLocale: "en-US" as const,
      values: Object.freeze({
        "zh-CN": adapterKey,
        "en-US": adapterKey,
      }),
    }),
    executionTarget: "worker" as const,
    sourceKinds: Object.freeze(["plugin" as const]),
    supportedModelFormats: Object.freeze([]),
    invocationInputSchema: Object.freeze({}),
    invocationOutputSchema: Object.freeze({}),
    configurationSchema: Object.freeze({}),
    artifactInputs: Object.freeze([]),
    executable: Object.freeze({
      kind: "built_in" as const,
      packageKey: "kanvas.test-runtime",
      packageVersion: "1.0.0",
      entrypoint: adapterKey,
      releaseDigest: `sha256:${"d".repeat(64)}`,
    }),
  });
}

function createCompletionStore(
  complete = vi.fn().mockResolvedValue({
    status: "completed",
  }),
): AtomicAttemptCompletionStore {
  return {
    complete,
  };
}

function createFailureStore(
  reportAttemptFailure = vi.fn().mockResolvedValue({
    status: "failed",
    reasonCode: "attempt.transition.blocked.retryability_terminal",
  }),
): AttemptFailureStore {
  return {
    reportAttemptFailure,
  };
}

function claimedAttempt(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    attemptId: ids.attempt,
    capabilityRunId: ids.capabilityRun,
    workflowRunId: ids.workflowRun,
    nodeRunId: ids.nodeRun,
    workspaceId: ids.workspace,
    actorId: ids.actor,
    executionTarget: "worker",
    bindingId: ids.binding,
    routeCandidateIndex: 0,
    candidateAttemptNumber: 1,
    implementationRevisionId: ids.implementation,
    implementationDigest: IMPLEMENTATION_DIGEST,
    adapterKey: "demo.echo.worker",
    runtimeAdapterRevisionId: ids.runtimeAdapterRevision,
    runtimeAdapterRevisionDigest: RUNTIME_ADAPTER_DIGEST,
    runtimeAdapter: runtimeAdapter("demo.echo.worker"),
    implementationConfiguration: {},
    compiledInputMapping: IDENTITY_INPUT_MAPPING,
    compiledOutputMapping: IDENTITY_OUTPUT_MAPPING,
    input: {
      message: "hello",
    },
    leaseGeneration: 1,
    executionDeadlineAt: EXECUTION_DEADLINE,
    ...overrides,
  };
}

interface QueueEnvelope {
  readonly outboxEventId: string;
  readonly workspaceId: string;
  readonly schemaVersion: 1;
  readonly messageType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly expectedGeneration: number;
  readonly [key: string]: unknown;
}

function workflowWakeupEnvelope(): QueueEnvelope {
  return Object.freeze({
    outboxEventId: ids.wakeupEvent,
    workspaceId: ids.workspace,
    schemaVersion: 1,
    messageType: "workflow.wakeup.requested",
    aggregateType: "workflow_run",
    aggregateId: ids.workflowRun,
    aggregateVersion: 1,
    expectedGeneration: 7,
    workflowRunId: ids.workflowRun,
  });
}

function workflowCancellationEnvelope(): QueueEnvelope {
  return Object.freeze({
    outboxEventId: ids.cancelEvent,
    workspaceId: ids.workspace,
    schemaVersion: 1,
    messageType: "workflow.cancel.requested",
    aggregateType: "workflow_run",
    aggregateId: ids.workflowRun,
    aggregateVersion: 2,
    expectedGeneration: 7,
    workflowRunId: ids.workflowRun,
  });
}

function capabilityTerminalEnvelope(
  messageType:
    | "capability.run.completed"
    | "capability.run.failed"
    | "capability.run.cancelled" = "capability.run.failed",
): QueueEnvelope {
  return Object.freeze({
    outboxEventId: ids.terminalEvent,
    workspaceId: ids.workspace,
    schemaVersion: 1,
    messageType,
    aggregateType: "capability_run",
    aggregateId: ids.capabilityRun,
    aggregateVersion: 2,
    expectedGeneration: 7,
    workflowRunId: ids.workflowRun,
    nodeRunId: ids.nodeRun,
    capabilityRunId: ids.capabilityRun,
  });
}

function attemptDispatchEnvelope(
  executionTarget: "worker" | "provider" = "worker",
): QueueEnvelope {
  return Object.freeze({
    outboxEventId: ids.dispatchEvent,
    workspaceId: ids.workspace,
    schemaVersion: 1,
    messageType: "attempt.dispatch.requested",
    aggregateType: "capability_attempt",
    aggregateId: ids.attempt,
    aggregateVersion: 1,
    expectedGeneration: 7,
    workflowRunId: ids.workflowRun,
    nodeRunId: ids.nodeRun,
    capabilityRunId: ids.capabilityRun,
    attemptId: ids.attempt,
    executionTarget,
  });
}

function canonicalEvent(envelope: QueueEnvelope) {
  return Object.freeze({
    eventId: envelope.outboxEventId,
    workspaceId: envelope.workspaceId,
    messageType: envelope.messageType,
    schemaVersion: envelope.schemaVersion,
    aggregateType: envelope.aggregateType,
    aggregateId: envelope.aggregateId,
    aggregateVersion: envelope.aggregateVersion,
    expectedGeneration: envelope.expectedGeneration,
    payload: envelope,
  });
}

function processedResult<T>(
  envelope: QueueEnvelope,
  value: T,
  resultCode: string,
  outcome: "applied" | "noop" = "applied",
) {
  return Object.freeze({
    deliveryStatus: "processed" as const,
    event: canonicalEvent(envelope),
    outcome,
    resultCode,
    value,
  });
}

function duplicateResult(
  envelope: QueueEnvelope,
  resultCode: string,
  outcome: "applied" | "noop" = "applied",
) {
  return Object.freeze({
    deliveryStatus: "duplicate" as const,
    event: canonicalEvent(envelope),
    outcome,
    resultCode,
  });
}

function expectedDelivery(
  envelope: QueueEnvelope,
  consumerName:
    | "workflow-orchestration.v1"
    | "attempt-dispatch.v1"
    | "provider-attempt-dispatch.v1"
    | "workflow-cancellation.v1",
) {
  return {
    consumerName,
    eventId: envelope.outboxEventId,
    workspaceId: envelope.workspaceId,
    schemaVersion: 1,
    messageType: envelope.messageType,
    aggregateType: envelope.aggregateType,
    aggregateId: envelope.aggregateId,
    aggregateVersion: envelope.aggregateVersion,
    expectedGeneration: envelope.expectedGeneration,
    receivedAt: NOW,
  };
}

function createRuntime(
  assertAllowed = vi.fn().mockResolvedValue({
    state: "ACTIVE",
    executionGeneration: 7,
    stateVersion: 1,
  }),
): ApplicationRuntime {
  return {
    runtimeFence: {
      assertAllowed,
    },
  } as unknown as ApplicationRuntime;
}

describe("workflow execution queue processors", () => {
  it("routes Workflow protocol v1 causes through the bounded frontier store", async () => {
    const envelope = workflowWakeupEnvelope();
    const consumeFrontier = vi.fn().mockResolvedValue(
      processedResult(
        envelope,
        {
          workflowRunId: ids.workflowRun,
          transitions: 3,
          nodeCreates: 1,
          continuationScheduled: true,
          lifecycleStatus: "running",
        },
        "workflow.v1.frontier_applied",
      ),
    );
    const read = vi.fn().mockResolvedValue({
      workflowRunId: ids.workflowRun,
      workspaceId: ids.workspace,
      protocolVersion: 1,
      lifecycleStatus: "queued",
      cancelReasonCode: null,
    });
    const startWorkflow = vi.fn();
    const processor = new WorkflowWakeupProcessor({
      runtime: createRuntime(),
      engine: {
        startWorkflow,
      } as unknown as WorkflowEngineStore,
      boundedOrchestrator: {
        consumeFrontier,
      } as unknown as BoundedWorkflowOrchestratorStore,
      orchestrationRouting: {
        read,
      },
      nextId: vi.fn(),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toEqual({
      protocolVersion: 1,
      deliveryStatus: "processed",
      resultCode: "workflow.v1.frontier_applied",
      lifecycleStatus: "running",
      transitions: 3,
      nodeCreates: 1,
      continuationScheduled: true,
    });
    expect(read).toHaveBeenCalledWith(ids.workspace, ids.workflowRun);
    expect(consumeFrontier).toHaveBeenCalledWith({
      workflowRunId: ids.workflowRun,
      executionGeneration: 7,
      now: NOW,
      delivery: expectedDelivery(envelope, "workflow-orchestration.v1"),
    });
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  it("uses cancellation settlement for a human-cancelling Run terminal event", async () => {
    const envelope = capabilityTerminalEnvelope("capability.run.cancelled");
    const consumeFrontier = vi.fn();
    const consumeCancellationCapabilityTerminal = vi.fn().mockResolvedValue(
      processedResult(
        envelope,
        {
          finished: false,
          cancellationSettled: true,
        },
        "workflow.settle.cancelled",
      ),
    );
    const processor = new WorkflowWakeupProcessor({
      runtime: createRuntime(),
      engine: {
        consumeCancellationCapabilityTerminal,
      } as unknown as WorkflowEngineStore,
      boundedOrchestrator: {
        consumeFrontier,
      } as unknown as BoundedWorkflowOrchestratorStore,
      orchestrationRouting: {
        read: () =>
          Promise.resolve({
            workflowRunId: ids.workflowRun,
            workspaceId: ids.workspace,
            protocolVersion: 1,
            lifecycleStatus: "cancelling",
            cancelReasonCode: "user_requested",
          }),
      },
      nextId: vi.fn(),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toEqual({
      finished: false,
      cancellationSettled: true,
      deliveryStatus: "processed",
      resultCode: "workflow.settle.cancelled",
    });
    expect(consumeCancellationCapabilityTerminal).toHaveBeenCalledOnce();
    expect(consumeFrontier).not.toHaveBeenCalled();
  });

  it("does not execute an adapter when an attempt delivery is a duplicate", async () => {
    const envelope = attemptDispatchEnvelope();
    const assertAllowed = vi.fn().mockResolvedValue({
      state: "ACTIVE",
      executionGeneration: 7,
      stateVersion: 1,
    });
    const claimAttempt = vi
      .fn()
      .mockResolvedValue(duplicateResult(envelope, "attempt.claim.applied"));
    const markAttemptStarted = vi.fn();
    const executeAdapter = vi.fn();
    const nextId = vi.fn();
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(assertAllowed),
      engine: {
        claimAttempt,
        markAttemptStarted,
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(),
      failures: createFailureStore(),
      nextId,
      executeAdapter,
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toEqual({
      claimed: false,
      deliveryStatus: "duplicate",
      resultCode: "attempt.claim.applied",
    });
    expect(claimAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityRunId: ids.capabilityRun,
        attemptId: ids.attempt,
        executionGeneration: 7,
        expectedExecutionTarget: "worker",
        delivery: expectedDelivery(envelope, "attempt-dispatch.v1"),
      }),
    );
    expect(assertAllowed).toHaveBeenCalledTimes(1);
    expect(markAttemptStarted).not.toHaveBeenCalled();
    expect(executeAdapter).not.toHaveBeenCalled();
    expect(nextId).not.toHaveBeenCalled();
  });

  it("rejects a provider payload on the worker processor before claiming or executing", async () => {
    const claimAttempt = vi.fn();
    const executeAdapter = vi.fn();
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(),
      engine: {
        claimAttempt,
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(),
      failures: createFailureStore(),
      nextId: vi.fn(),
      executeAdapter,
      now: () => NOW,
    });

    await expect(
      processor.handle(attemptDispatchEnvelope("provider")),
    ).rejects.toMatchObject({
      code: "delivery.job_target_mismatch",
    });
    expect(claimAttempt).not.toHaveBeenCalled();
    expect(executeAdapter).not.toHaveBeenCalled();
  });

  it("does not invoke an adapter if the claimed canonical target differs", async () => {
    const envelope = attemptDispatchEnvelope();
    const claimAttempt = vi.fn().mockResolvedValue(
      processedResult(
        envelope,
        {
          attemptId: ids.attempt,
          capabilityRunId: ids.capabilityRun,
          workflowRunId: ids.workflowRun,
          nodeRunId: ids.nodeRun,
          workspaceId: ids.workspace,
          adapterKey: "provider.remote",
          input: {},
          executionTarget: "provider",
          leaseGeneration: 1,
        },
        "attempt.claim.applied",
      ),
    );
    const markAttemptStarted = vi.fn();
    const executeAdapter = vi.fn();
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(),
      engine: {
        claimAttempt,
        markAttemptStarted,
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(),
      failures: createFailureStore(),
      nextId: vi.fn(),
      executeAdapter,
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).rejects.toEqual(
      new PermanentInboxDeliveryError(
        "delivery.claimed_execution_target_mismatch",
      ),
    );
    expect(markAttemptStarted).not.toHaveBeenCalled();
    expect(executeAdapter).not.toHaveBeenCalled();
  });

  it("claims and completes the demo worker capability under one lease", async () => {
    const envelope = attemptDispatchEnvelope();
    const assertAllowed = vi.fn().mockResolvedValue({
      state: "ACTIVE",
      executionGeneration: 7,
      stateVersion: 1,
    });
    let claimedLeaseTokenHash: string | undefined;
    const claimAttempt = vi.fn(
      (options: { readonly leaseTokenHash: string }) => {
        claimedLeaseTokenHash = options.leaseTokenHash;
        return Promise.resolve(
          processedResult(envelope, claimedAttempt(), "attempt.claim.applied"),
        );
      },
    );
    const markAttemptStarted = vi.fn().mockResolvedValue(true);
    const heartbeatAttempt = vi.fn().mockResolvedValue("renewed");
    const complete = vi.fn().mockResolvedValue({
      status: "completed",
    });
    const nextId = vi
      .fn()
      .mockReturnValueOnce(ids.completion)
      .mockReturnValueOnce(ids.completionOutbox);
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(assertAllowed),
      engine: {
        claimAttempt,
        markAttemptStarted,
        heartbeatAttempt,
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(complete),
      failures: createFailureStore(),
      nextId,
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toEqual({
      claimed: true,
      completed: true,
      output: {
        message: "hello",
      },
      deliveryStatus: "processed",
      resultCode: "attempt.claim.applied",
    });
    expect(assertAllowed).toHaveBeenNthCalledWith(1, {
      action: "claim",
      expectedGeneration: 7,
    });
    expect(assertAllowed).toHaveBeenNthCalledWith(2, {
      action: "dispatch",
      expectedGeneration: 7,
    });
    expect(assertAllowed).toHaveBeenNthCalledWith(3, {
      action: "complete",
      expectedGeneration: 7,
    });
    expect(claimAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityRunId: ids.capabilityRun,
        attemptId: ids.attempt,
        executionGeneration: 7,
        expectedExecutionTarget: "worker",
        delivery: expectedDelivery(envelope, "attempt-dispatch.v1"),
      }),
    );
    expect(claimedLeaseTokenHash).toEqual(expect.any(String));
    expect(markAttemptStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityRunId: ids.capabilityRun,
        attemptId: ids.attempt,
        leaseTokenHash: claimedLeaseTokenHash,
        leaseGeneration: 1,
      }),
    );
    expect(complete).toHaveBeenCalledWith({
      workspaceId: ids.workspace,
      capabilityRunId: ids.capabilityRun,
      attemptId: ids.attempt,
      completionId: ids.completion,
      terminalOutboxEventId: ids.completionOutbox,
      executionGeneration: 7,
      target: {
        executionTarget: "worker",
        implementationRevisionId: ids.implementation,
        implementationDigest: IMPLEMENTATION_DIGEST,
        adapterKey: "demo.echo.worker",
        attemptLeaseGeneration: 1,
        domainLeaseTokenHash: claimedLeaseTokenHash,
      },
      capabilityOutput: {
        message: "hello",
      },
      outputs: [],
      initialUsage: [],
      now: NOW,
    });
  });

  it("maps public input to adapter input and maps native output back", async () => {
    const envelope = attemptDispatchEnvelope();
    const inputMapping = {
      schemaVersion: "kanvas.compiled-capability-mapping/v1" as const,
      direction: "input" as const,
      expression: {
        op: "object" as const,
        properties: [
          [
            "payload",
            {
              op: "source" as const,
              root: "input" as const,
              path: ["message"],
            },
          ] as const,
        ],
      },
    };
    const outputMapping = {
      schemaVersion: "kanvas.compiled-capability-mapping/v1" as const,
      direction: "output" as const,
      expression: {
        op: "object" as const,
        properties: [
          [
            "message",
            {
              op: "source" as const,
              root: "result" as const,
              path: ["reply"],
            },
          ] as const,
        ],
      },
    };
    const executeAdapter = vi.fn().mockResolvedValue({ reply: "mapped" });
    const complete = vi.fn().mockResolvedValue({ status: "completed" });
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(),
      engine: {
        claimAttempt: vi.fn().mockResolvedValue(
          processedResult(
            envelope,
            claimedAttempt({
              compiledInputMapping: inputMapping,
              compiledOutputMapping: outputMapping,
            }),
            "attempt.claim.applied",
          ),
        ),
        markAttemptStarted: vi.fn().mockResolvedValue(true),
        heartbeatAttempt: vi.fn().mockResolvedValue("renewed"),
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(complete),
      failures: createFailureStore(),
      executeAdapter,
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.completion)
        .mockReturnValueOnce(ids.completionOutbox),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      completed: true,
      output: { message: "mapped" },
    });
    expect(executeAdapter).toHaveBeenCalledWith(
      "demo.echo.worker",
      { payload: "hello" },
      expect.any(AbortSignal),
      expect.any(Object),
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityOutput: { message: "mapped" } }),
    );
  });

  it("binds trusted input Artifact access to the claimed Attempt input", async () => {
    const envelope = attemptDispatchEnvelope();
    const input = {
      sourceArtifactId: ulid("29"),
    };
    const inputArtifactAccess: WorkerInputArtifactAccess = {
      open: vi.fn<WorkerInputArtifactAccess["open"]>(),
    };
    const bind = vi
      .fn<WorkerInputArtifactResolver["bind"]>()
      .mockReturnValue(inputArtifactAccess);
    const executeAdapter = vi.fn(
      (
        _adapterKey: string,
        _input: unknown,
        _signal: AbortSignal,
        context: WorkerAdapterExecutionContext,
      ) => {
        expect(context).toMatchObject({
          workspaceId: ids.workspace,
          workflowRunId: ids.workflowRun,
          nodeRunId: ids.nodeRun,
          capabilityRunId: ids.capabilityRun,
          attemptId: ids.attempt,
          inputArtifacts: inputArtifactAccess,
        });
        return Promise.resolve({
          message: "resolved",
        });
      },
    );
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(),
      engine: {
        claimAttempt: vi.fn().mockResolvedValue(
          processedResult(
            envelope,
            claimedAttempt({
              adapterKey: "test.image.worker",
              input,
            }),
            "attempt.claim.applied",
          ),
        ),
        markAttemptStarted: vi.fn().mockResolvedValue(true),
        heartbeatAttempt: vi.fn().mockResolvedValue("renewed"),
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(),
      failures: createFailureStore(),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.completion)
        .mockReturnValueOnce(ids.completionOutbox),
      executeAdapter,
      inputArtifactResolver: {
        bind,
      },
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      completed: true,
      output: {
        message: "resolved",
      },
    });
    expect(bind).toHaveBeenCalledOnce();
    const bindRequest = bind.mock.calls[0]?.[0];
    expect(bindRequest?.workspaceId).toBe(ids.workspace);
    expect(bindRequest?.input).toEqual(input);
    expect(bindRequest?.signal).toBeInstanceOf(AbortSignal);
    expect(executeAdapter).toHaveBeenCalledOnce();
  });

  it("materializes Worker image outputs and resolves Artifact references before atomic completion", async () => {
    const envelope = attemptDispatchEnvelope();
    const materializedOutput = Object.freeze({
      uploadSessionId: ulid("25"),
      storedObjectId: ulid("26"),
      artifactId: ulid("27"),
      attemptOutputId: ulid("28"),
      outputRole: "primary",
      outputIndex: 0,
      artifactType: "image.cutout",
      metadata: Object.freeze({
        background: "transparent",
      }),
    });
    const materialize = vi.fn().mockResolvedValue([materializedOutput]);
    const complete = vi.fn().mockResolvedValue({
      status: "completed",
    });
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(),
      engine: {
        claimAttempt: vi.fn().mockResolvedValue(
          processedResult(
            envelope,
            claimedAttempt({
              adapterKey: "test.image.worker",
            }),
            "attempt.claim.applied",
          ),
        ),
        markAttemptStarted: vi.fn().mockResolvedValue(true),
        heartbeatAttempt: vi.fn().mockResolvedValue("renewed"),
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(complete),
      failures: createFailureStore(),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.completion)
        .mockReturnValueOnce(ids.completionOutbox),
      executeAdapter: vi.fn().mockResolvedValue({
        protocol: "kanvas.worker-adapter-result/v1",
        capabilityOutput: {
          artifactId: {
            $kanvas: "attempt-output-artifact/v1",
            outputRole: "primary",
            outputIndex: 0,
          },
        },
        outputs: [
          {
            outputRole: "primary",
            outputIndex: 0,
            artifactType: "image.cutout",
            metadata: {
              background: "transparent",
            },
            mediaType: "image/png",
            body: (async function* () {
              await Promise.resolve();
              yield new Uint8Array([1, 2, 3]);
            })(),
          },
        ],
      }),
      outputMaterializer: {
        materialize,
      },
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      completed: true,
      output: {
        artifactId: materializedOutput.artifactId,
      },
    });
    expect(materialize).toHaveBeenCalledOnce();
    const materializeRequest = materialize.mock
      .calls[0]?.[0] as MaterializeWorkerAttemptOutputsRequest;
    expect(materializeRequest.context).toEqual({
      workspaceId: ids.workspace,
      actorId: ids.actor,
      attemptId: ids.attempt,
      executionDeadlineAt: EXECUTION_DEADLINE,
      executionTarget: "worker",
    });
    expect(materializeRequest.outputs).toHaveLength(1);
    expect(materializeRequest.signal).toBeInstanceOf(AbortSignal);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityOutput: {
          artifactId: materializedOutput.artifactId,
        },
        outputs: [materializedOutput],
      }),
    );
  });

  it("runs the deterministic image canary through trusted input, output materialization and atomic completion", async () => {
    const envelope = attemptDispatchEnvelope();
    const sourceArtifactId = ulid("31");
    const sourceStoredObjectId = ulid("32");
    const storageProfileId = ulid("33");
    const compatibilityProbeId = ulid("34");
    const outputUploadSessionId = ulid("35");
    const outputStoredObjectId = ulid("36");
    const outputArtifactId = ulid("37");
    const attemptOutputId = ulid("38");
    const randomObjectId = ulid("39");
    const sourceBytes = createDeterministicRgbaPng({
      width: 4,
      height: 4,
      rgba: [220, 80, 40, 255],
    });
    const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    const input = {
      sourceArtifactId,
    };
    const readAuthorizedCommittedObject = vi
      .fn<StorageUploadStore["readAuthorizedCommittedObject"]>()
      .mockResolvedValue({
        artifactId: sourceArtifactId,
        storedObjectId: sourceStoredObjectId,
        artifactType: "image",
        dataClassification: "internal",
        displayFilename: "source.png",
        storageProfileId,
        container: "worker-closure",
        objectKey: "private/source/object",
        immutableIdentityHash: `sha256:${"b".repeat(64)}`,
        byteSize: sourceBytes.byteLength.toString(),
        sha256: sourceSha256,
        mediaType: "image/png",
      });
    const openRead = vi.fn<StoragePort["openRead"]>().mockResolvedValue({
      identity: {
        storageProfileId,
        container: "worker-closure",
        objectKey: "private/source/object",
      },
      totalByteSize: sourceBytes.byteLength.toString(),
      contentByteSize: sourceBytes.byteLength.toString(),
      body: (async function* () {
        await Promise.resolve();
        yield sourceBytes;
      })(),
    });
    const storageAdapter = {
      storageProfileId,
      kind: "local",
      openRead,
    } as unknown as StoragePort;
    const verifiedOutputBytes: Buffer[] = [];
    const ingest = vi.fn<TrustedImageStorageRuntime["uploads"]["ingest"]>(
      async ({ session, body }) => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of body) {
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        verifiedOutputBytes.push(bytes);
        await verifyTrustedImage({
          body: (async function* () {
            await Promise.resolve();
            yield bytes;
          })(),
          declaredMediaType: "image/png",
          limits: {
            maximumInputBytes: 1_048_576,
            maximumWidth: 256,
            maximumHeight: 256,
            maximumPixels: 65_536,
            maximumDecodedBytes: 262_144,
            maximumExpansionRatio: 100_000,
            requireDecodedVerification: false,
          },
          verificationProfileVersion: "deterministic-canary-v1",
        });
        return {
          uploadSessionId: session.id,
          state: "verified",
          replayed: false,
        };
      },
    );
    const allocateUploadSession = vi.fn<
      StorageUploadStore["allocateUploadSession"]
    >((options) =>
      Promise.resolve({
        id: options.id,
        workspaceId: options.workspaceId,
        actorId: options.actorId,
        purpose: options.purpose,
        attemptId: options.attemptId,
        outputRole: options.outputRole,
        outputIndex: options.outputIndex,
        expectedSize: options.expectedSize,
        expectedMediaType: options.expectedMediaType,
        expectedSha256: options.expectedSha256,
        storageProfileId: options.storageProfileId,
        compatibilityProbeId: options.compatibilityProbeId,
        profileConfigurationHash: options.profileConfigurationHash,
        container: options.container,
        objectKey: options.objectKey,
        uploadMode: options.uploadMode,
        writeProtectionMode: options.writeProtectionMode,
        state: "open",
        version: 1,
        expiresAt: options.expiresAt,
        cleanupEligibleAt: options.cleanupEligibleAt,
        verificationProfileVersion: options.verificationProfileVersion,
        replayed: false,
      } as UploadSessionRecord),
    );
    const storageRuntime = {
      profileId: storageProfileId,
      profileConfigurationHash: `sha256:${"c".repeat(64)}`,
      container: "worker-closure",
      maximumInputBytes: 1_048_576,
      cleanupGraceMilliseconds: 60_000,
      verificationProfileVersion: "trusted-image-structural-v1",
      profiles: {
        resolve: (profileId: string) =>
          profileId === storageProfileId
            ? {
                storageProfileId,
                kind: "local" as const,
                adapter: storageAdapter,
              }
            : undefined,
      },
      uploads: {
        ingest,
      },
      ensureCompatibilityProbe: vi.fn().mockResolvedValue({
        id: compatibilityProbeId,
      }),
    } as unknown as TrustedImageStorageRuntime;
    const storageStore = {
      readAuthorizedCommittedObject,
      allocateUploadSession,
    } as unknown as StorageUploadStore;
    const inputArtifactResolver = createWorkerInputArtifactResolver({
      runtime: storageRuntime,
      store: storageStore,
      authorizeConsumerArtifact: () => Promise.resolve(),
      allowedDataClassifications: ["internal"],
    });
    const materializerNextId = vi
      .fn()
      .mockReturnValueOnce(compatibilityProbeId)
      .mockReturnValueOnce(outputUploadSessionId)
      .mockReturnValueOnce(outputStoredObjectId)
      .mockReturnValueOnce(outputArtifactId)
      .mockReturnValueOnce(attemptOutputId)
      .mockReturnValueOnce(randomObjectId);
    const outputMaterializer = createWorkerAttemptOutputMaterializer({
      runtime: storageRuntime,
      store: storageStore,
      nextId: materializerNextId,
      now: () => NOW,
    });
    const adapters = createWorkerAdapterRegistry([
      deterministicImageDerivedPngAdapter,
    ]);
    const complete = vi.fn().mockResolvedValue({
      status: "completed",
    });
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(),
      engine: {
        claimAttempt: vi.fn().mockResolvedValue(
          processedResult(
            envelope,
            claimedAttempt({
              adapterKey: deterministicImageDerivedPngAdapterKey,
              runtimeAdapter: runtimeAdapter(
                deterministicImageDerivedPngAdapterKey,
              ),
              input,
            }),
            "attempt.claim.applied",
          ),
        ),
        markAttemptStarted: vi.fn().mockResolvedValue(true),
        heartbeatAttempt: vi.fn().mockResolvedValue("renewed"),
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(complete),
      failures: createFailureStore(),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.completion)
        .mockReturnValueOnce(ids.completionOutbox),
      executeAdapter: adapters.execute,
      inputArtifactResolver,
      outputMaterializer,
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      completed: true,
      output: {
        schemaVersion: "kanvas.deterministic-image-result/v1",
        imageArtifactId: outputArtifactId,
        sourceArtifactId,
        capabilityRunId: ids.capabilityRun,
      },
    });
    expect(readAuthorizedCommittedObject).toHaveBeenCalledWith({
      workspaceId: ids.workspace,
      artifactId: sourceArtifactId,
      allowedDataClassifications: ["internal"],
    });
    expect(openRead).toHaveBeenCalledOnce();
    expect(ingest).toHaveBeenCalledOnce();
    expect(verifiedOutputBytes).toHaveLength(1);
    expect(verifiedOutputBytes[0]).not.toEqual(sourceBytes);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityOutput: {
          schemaVersion: "kanvas.deterministic-image-result/v1",
          imageArtifactId: outputArtifactId,
          sourceArtifactId,
          capabilityRunId: ids.capabilityRun,
        },
        outputs: [
          expect.objectContaining({
            uploadSessionId: outputUploadSessionId,
            storedObjectId: outputStoredObjectId,
            artifactId: outputArtifactId,
            attemptOutputId,
            outputRole: "primary",
            outputIndex: 0,
            artifactType: "image",
          }),
        ],
      }),
    );
  });

  it("reports a trusted Adapter failure through the shared transition kernel", async () => {
    const envelope = attemptDispatchEnvelope();
    const claimAttempt = vi
      .fn()
      .mockResolvedValue(
        processedResult(envelope, claimedAttempt(), "attempt.claim.applied"),
      );
    const markAttemptStarted = vi.fn().mockResolvedValue(true);
    const reports: ReportAttemptFailureOptions[] = [];
    const reportAttemptFailure = vi.fn(
      (report: ReportAttemptFailureOptions) => {
        reports.push(report);
        return Promise.resolve({
          status: "retried" as const,
          reasonCode: "attempt.transition.retry.not_started",
          nextAttemptId: ids.failureNextAttempt,
          nextExecutionTarget: "worker" as const,
        });
      },
    );
    const nextId = vi
      .fn()
      .mockReturnValueOnce(ids.failureNextAttempt)
      .mockReturnValueOnce(ids.failureOutbox);
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(),
      engine: {
        claimAttempt,
        markAttemptStarted,
        heartbeatAttempt: vi.fn().mockResolvedValue("renewed"),
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(),
      failures: createFailureStore(reportAttemptFailure),
      nextId,
      executeAdapter: vi.fn().mockRejectedValue(
        new AdapterFailure({
          stableErrorCode: "worker.adapter.input_rejected",
          sideEffectState: "not_started",
          retryability: "retryable",
          evidenceDigest: `sha256:${"b".repeat(64)}`,
          stableIdempotencyKeyAvailable: true,
        }),
      ),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toEqual({
      claimed: true,
      retried: true,
      fallback: false,
      failed: false,
      manual: false,
      reasonCode: "attempt.transition.retry.not_started",
      nextAttemptId: ids.failureNextAttempt,
      nextExecutionTarget: "worker",
    });
    const report = reports[0];
    if (!report || report.target.reporter !== "worker") {
      throw new Error("Expected one canonical Worker failure report.");
    }
    expect(report.target.domainLeaseTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report).toEqual({
      workspaceId: ids.workspace,
      capabilityRunId: ids.capabilityRun,
      attemptId: ids.attempt,
      nextAttemptId: ids.failureNextAttempt,
      outboxEventId: ids.failureOutbox,
      executionGeneration: 7,
      target: {
        reporter: "worker",
        executionTarget: "worker",
        implementationRevisionId: ids.implementation,
        implementationDigest: IMPLEMENTATION_DIGEST,
        adapterKey: "demo.echo.worker",
        attemptLeaseGeneration: 1,
        domainLeaseTokenHash: report.target.domainLeaseTokenHash,
      },
      failure: {
        stableErrorCode: "worker.adapter.input_rejected",
        sideEffectState: "not_started",
        retryability: "retryable",
        evidenceDigest: `sha256:${"b".repeat(64)}`,
        stableIdempotencyKeyAvailable: true,
        cause: "failed",
      },
      now: NOW,
    });
  });

  it("fails closed for an unclassified exception", async () => {
    const envelope = attemptDispatchEnvelope();
    const reports: ReportAttemptFailureOptions[] = [];
    const reportAttemptFailure = vi.fn(
      (report: ReportAttemptFailureOptions) => {
        reports.push(report);
        return Promise.resolve({
          status: "manual" as const,
          reasonCode: "attempt.transition.blocked.retryability_manual",
        });
      },
    );
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(),
      engine: {
        claimAttempt: vi
          .fn()
          .mockResolvedValue(
            processedResult(
              envelope,
              claimedAttempt(),
              "attempt.claim.applied",
            ),
          ),
        markAttemptStarted: vi.fn().mockResolvedValue(true),
        heartbeatAttempt: vi.fn().mockResolvedValue("renewed"),
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(),
      failures: createFailureStore(reportAttemptFailure),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.failureNextAttempt)
        .mockReturnValueOnce(ids.failureOutbox),
      executeAdapter: vi
        .fn()
        .mockRejectedValue(new Error("provider leaked a secret")),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      failed: true,
      manual: true,
      retried: false,
      fallback: false,
    });
    expect(reports[0]?.failure).toMatchObject({
      stableErrorCode: "worker.adapter.unclassified",
      sideEffectState: "unknown",
      retryability: "manual",
      stableIdempotencyKeyAvailable: false,
    });
    expect(reports[0]?.failure.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(reports)).not.toContain("provider leaked a secret");
  });

  it("reports unavailable trusted input Artifact access as an operator action", async () => {
    const envelope = attemptDispatchEnvelope();
    const reports: ReportAttemptFailureOptions[] = [];
    const reportAttemptFailure = vi.fn(
      (report: ReportAttemptFailureOptions) => {
        reports.push(report);
        return Promise.resolve({
          status: "manual" as const,
          reasonCode: "attempt.transition.blocked.retryability_manual",
        });
      },
    );
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(),
      engine: {
        claimAttempt: vi.fn().mockResolvedValue(
          processedResult(
            envelope,
            claimedAttempt({
              input: {
                sourceArtifactId: ulid("30"),
              },
            }),
            "attempt.claim.applied",
          ),
        ),
        markAttemptStarted: vi.fn().mockResolvedValue(true),
        heartbeatAttempt: vi.fn().mockResolvedValue("renewed"),
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(),
      failures: createFailureStore(reportAttemptFailure),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.failureNextAttempt)
        .mockReturnValueOnce(ids.failureOutbox),
      executeAdapter: (_adapterKey, _input, _signal, context) =>
        context.inputArtifacts.open({
          inputPointer: "/sourceArtifactId",
        }),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      failed: true,
      manual: true,
    });
    expect(reports[0]?.failure).toMatchObject({
      stableErrorCode: "worker.input_artifact_resolution.unavailable_failed",
      sideEffectState: "not_started",
      retryability: "manual",
      stableIdempotencyKeyAvailable: false,
    });
  });

  it("treats failure-transition lease conflict as a lost Worker lease", async () => {
    const envelope = attemptDispatchEnvelope();
    const reportAttemptFailure = vi
      .fn()
      .mockRejectedValue(
        new AttemptFailureStoreError(
          "attempt_failure.state_conflict",
          "lease lost",
        ),
      );
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(),
      engine: {
        claimAttempt: vi
          .fn()
          .mockResolvedValue(
            processedResult(
              envelope,
              claimedAttempt(),
              "attempt.claim.applied",
            ),
          ),
        markAttemptStarted: vi.fn().mockResolvedValue(true),
        heartbeatAttempt: vi.fn().mockResolvedValue("renewed"),
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(),
      failures: createFailureStore(reportAttemptFailure),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.failureNextAttempt)
        .mockReturnValueOnce(ids.failureOutbox),
      executeAdapter: vi.fn().mockRejectedValue(
        new AdapterFailure({
          stableErrorCode: "worker.adapter.remote_failed",
          sideEffectState: "started",
          retryability: "retryable",
          evidenceDigest: `sha256:${"c".repeat(64)}`,
        }),
      ),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).rejects.toBeInstanceOf(
      AttemptLeaseLostError,
    );
    expect(reportAttemptFailure).toHaveBeenCalledOnce();
  });

  it("aborts execution and does not complete after heartbeat lease loss", async () => {
    const envelope = attemptDispatchEnvelope();
    const claimAttempt = vi.fn().mockResolvedValue(
      processedResult(
        envelope,
        claimedAttempt({
          adapterKey: "test.slow",
          input: {},
          leaseGeneration: 3,
        }),
        "attempt.claim.applied",
      ),
    );
    const markAttemptStarted = vi.fn().mockResolvedValue(true);
    const heartbeatAttempt = vi.fn().mockResolvedValue("rejected");
    const complete = vi.fn().mockResolvedValue({
      status: "completed",
    });
    const executeAdapter = vi.fn(
      (_adapterKey: string, _input: unknown, signal: AbortSignal) =>
        new Promise<unknown>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("Adapter execution aborted."),
              );
            },
            { once: true },
          );
        }),
    );
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(),
      engine: {
        claimAttempt,
        markAttemptStarted,
        heartbeatAttempt,
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(complete),
      failures: createFailureStore(),
      nextId: () => ids.completionOutbox,
      executeAdapter,
      leaseDurationMs: 20,
      heartbeatIntervalMs: 5,
      attemptTimeoutMs: 100,
    });

    await expect(processor.handle(envelope)).rejects.toBeInstanceOf(
      AttemptLeaseLostError,
    );
    expect(heartbeatAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityRunId: ids.capabilityRun,
        attemptId: ids.attempt,
        leaseGeneration: 3,
      }),
    );
    expect(executeAdapter).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });

  it("aborts and acknowledges a running attempt when heartbeat observes cancellation", async () => {
    const envelope = attemptDispatchEnvelope();
    const assertAllowed = vi.fn().mockResolvedValue({
      state: "ACTIVE",
      executionGeneration: 7,
      stateVersion: 1,
    });
    const claimAttempt = vi.fn().mockResolvedValue(
      processedResult(
        envelope,
        claimedAttempt({
          adapterKey: "test.slow",
          input: {},
          leaseGeneration: 3,
        }),
        "attempt.claim.applied",
      ),
    );
    const markAttemptStarted = vi.fn().mockResolvedValue(true);
    const heartbeatAttempt = vi.fn().mockResolvedValue("cancel_requested");
    const acknowledgeAttemptCancellation = vi.fn().mockResolvedValue(true);
    const complete = vi.fn().mockResolvedValue({
      status: "completed",
    });
    const executeAdapter = vi.fn(
      (_adapterKey: string, _input: unknown, signal: AbortSignal) =>
        new Promise<unknown>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("Adapter execution aborted."),
              );
            },
            { once: true },
          );
        }),
    );
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(assertAllowed),
      engine: {
        claimAttempt,
        markAttemptStarted,
        heartbeatAttempt,
        acknowledgeAttemptCancellation,
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(complete),
      failures: createFailureStore(),
      nextId: () => ids.cancellationOutbox,
      executeAdapter,
      leaseDurationMs: 20,
      heartbeatIntervalMs: 5,
      attemptTimeoutMs: 100,
    });

    await expect(processor.handle(envelope)).resolves.toEqual({
      claimed: true,
      cancelled: true,
    });
    expect(acknowledgeAttemptCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityRunId: ids.capabilityRun,
        attemptId: ids.attempt,
        leaseGeneration: 3,
        outboxEventId: ids.cancellationOutbox,
        executionGeneration: 7,
      }),
    );
    expect(assertAllowed).toHaveBeenLastCalledWith({
      action: "cancel",
      expectedGeneration: 7,
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("acknowledges cancellation that wins after adapter output but before completion", async () => {
    const envelope = attemptDispatchEnvelope();
    const claimAttempt = vi.fn().mockResolvedValue(
      processedResult(
        envelope,
        claimedAttempt({
          input: {
            message: "ready",
          },
          leaseGeneration: 4,
        }),
        "attempt.claim.applied",
      ),
    );
    const markAttemptStarted = vi.fn().mockResolvedValue(true);
    const complete = vi
      .fn()
      .mockRejectedValue(
        new AtomicAttemptCompletionStoreError(
          "attempt_completion.state_conflict",
          "Cancellation won completion arbitration.",
        ),
      );
    const acknowledgeAttemptCancellation = vi.fn().mockResolvedValue(true);
    const nextId = vi
      .fn()
      .mockReturnValueOnce(ids.completion)
      .mockReturnValueOnce(ids.completionOutbox)
      .mockReturnValueOnce(ids.cancellationOutbox);
    const processor = new AttemptDispatchProcessor({
      runtime: createRuntime(),
      engine: {
        claimAttempt,
        markAttemptStarted,
        heartbeatAttempt: vi.fn().mockResolvedValue("renewed"),
        acknowledgeAttemptCancellation,
      } as unknown as WorkflowEngineStore,
      completions: createCompletionStore(complete),
      failures: createFailureStore(),
      nextId,
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toEqual({
      claimed: true,
      cancelled: true,
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        completionId: ids.completion,
        terminalOutboxEventId: ids.completionOutbox,
        executionGeneration: 7,
      }),
    );
    expect(acknowledgeAttemptCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxEventId: ids.cancellationOutbox,
        leaseGeneration: 4,
        executionGeneration: 7,
      }),
    );
  });

  it("uses the orchestration Inbox consumer to settle workflow cancellation", async () => {
    const envelope = workflowCancellationEnvelope();
    const assertAllowed = vi.fn().mockResolvedValue({
      state: "MAINTENANCE",
      executionGeneration: 7,
      stateVersion: 1,
    });
    const consumeWorkflowCancellationSettlement = vi
      .fn()
      .mockResolvedValue(
        processedResult(envelope, true, "workflow.settle.cancelled"),
      );
    const processor = new WorkflowWakeupProcessor({
      runtime: createRuntime(assertAllowed),
      engine: {
        consumeWorkflowCancellationSettlement,
      } as unknown as WorkflowEngineStore,
      boundedOrchestrator: {
        consumeFrontier: vi.fn(),
      } as unknown as BoundedWorkflowOrchestratorStore,
      orchestrationRouting: {
        read: () =>
          Promise.resolve({
            workflowRunId: ids.workflowRun,
            workspaceId: ids.workspace,
            protocolVersion: 1,
            lifecycleStatus: "cancelling",
            cancelReasonCode: "user_requested",
          }),
      },
      nextId: vi.fn(),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toEqual({
      finished: false,
      cancellationSettled: true,
      deliveryStatus: "processed",
      resultCode: "workflow.settle.cancelled",
    });
    expect(assertAllowed).toHaveBeenCalledWith({
      action: "cancel",
      expectedGeneration: 7,
    });
    expect(consumeWorkflowCancellationSettlement).toHaveBeenCalledWith({
      workflowRunId: ids.workflowRun,
      now: NOW,
      executionGeneration: 7,
      delivery: expectedDelivery(envelope, "workflow-orchestration.v1"),
    });
  });

  it("uses the execution Inbox consumer to apply the same cancellation event", async () => {
    const envelope = workflowCancellationEnvelope();
    const assertAllowed = vi.fn().mockResolvedValue({
      state: "ACTIVE",
      executionGeneration: 7,
      stateVersion: 1,
    });
    const processWorkflowCancellation = vi
      .fn()
      .mockResolvedValue(
        processedResult(
          envelope,
          "capability_cancelled",
          "workflow.cancel.capability_cancelled",
        ),
      );
    const processor = new WorkflowCancellationProcessor({
      runtime: createRuntime(assertAllowed),
      engine: {
        processWorkflowCancellation,
      } as unknown as WorkflowEngineStore,
      nextId: () => ids.cancellationOutbox,
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toEqual({
      result: "capability_cancelled",
      deliveryStatus: "processed",
      resultCode: "workflow.cancel.capability_cancelled",
    });
    expect(assertAllowed).toHaveBeenCalledWith({
      action: "cancel",
      expectedGeneration: 7,
    });
    expect(processWorkflowCancellation).toHaveBeenCalledWith({
      workflowRunId: ids.workflowRun,
      now: NOW,
      outboxEventId: ids.cancellationOutbox,
      executionGeneration: 7,
      delivery: expectedDelivery(envelope, "workflow-cancellation.v1"),
    });
  });
});
