import { createHash, randomBytes } from "node:crypto";

import type { ApplicationRuntime } from "@kanvas/application";
import {
  executeCapabilityMappingPlanV1,
  resolveAttemptOutputArtifactReferences,
} from "@kanvas/contracts/capability";
import {
  AtomicAttemptCompletionStoreError,
  AttemptFailureStoreError,
  type AttemptCompletionOutput,
  type AttemptFailureStore,
  type AtomicAttemptCompletionStore,
  type BoundedWorkflowOrchestratorStore,
  type WorkflowOrchestrationRoutingFact,
  type WorkflowOrchestrationRoutingStore,
  type WorkflowEngineStore,
} from "@kanvas/database/runtime";

import {
  AttemptCancellationRequestedError,
  AttemptLeaseLostError,
  AttemptHeartbeat,
} from "./attempt-heartbeat.js";
import {
  PermanentInboxDeliveryError,
  parseAttemptDispatchDelivery,
  parseWorkflowCancellationDelivery,
  parseWorkflowOrchestrationDelivery,
  type AttemptDispatchRequestedPayload,
} from "./inbox-delivery.js";
import { normalizeAdapterFailure } from "./worker-adapter-failure.js";
import type {
  WorkerAdapterExecutionResult,
  WorkerAdapterExecutor,
} from "../adapter/worker-adapter.js";
import { createWorkerRuntimeAdapterRegistry } from "../adapter/worker-runtime-adapters.js";
import type { WorkerAttemptOutputMaterializer } from "../storage/worker-attempt-output-materializer.js";
import {
  createUnavailableWorkerInputArtifactAccess,
  type WorkerInputArtifactResolver,
} from "../storage/worker-input-artifact-resolver.js";
import type { WorkerModelResourceResolver } from "../storage/worker-model-resource-resolver.js";

export const EXECUTION_QUEUE = "kanvas-execution";
export const PROVIDER_EXECUTION_QUEUE = "kanvas-provider-execution";

interface ProcessorDependencies {
  readonly runtime: ApplicationRuntime;
  readonly engine: WorkflowEngineStore;
  readonly boundedOrchestrator?: BoundedWorkflowOrchestratorStore;
  readonly orchestrationRouting?: WorkflowOrchestrationRoutingStore;
  readonly nextId: () => string;
  readonly now?: () => Date;
}

interface WorkflowWakeupProcessorDependencies extends ProcessorDependencies {
  readonly boundedOrchestrator: BoundedWorkflowOrchestratorStore;
  readonly orchestrationRouting: WorkflowOrchestrationRoutingStore;
}

interface AttemptProcessorDependencies extends ProcessorDependencies {
  readonly completions: AtomicAttemptCompletionStore;
  readonly failures: AttemptFailureStore;
  readonly executeAdapter?: WorkerAdapterExecutor;
  readonly inputArtifactResolver?: WorkerInputArtifactResolver;
  readonly modelResourceResolver?: WorkerModelResourceResolver;
  readonly outputMaterializer?: WorkerAttemptOutputMaterializer;
  readonly leaseDurationMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly attemptTimeoutMs?: number;
}

const builtInWorkerAdapters = createWorkerRuntimeAdapterRegistry({
  deterministicImageAdapterEnabled: false,
});

function normalizeAdapterResult(value: unknown): WorkerAdapterExecutionResult {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "protocol" in value &&
    value.protocol === "kanvas.worker-adapter-result/v1"
  ) {
    if (!("outputs" in value) || !Array.isArray(value.outputs)) {
      throw new TypeError("Worker Adapter result outputs must be an array.");
    }
    return value as unknown as WorkerAdapterExecutionResult;
  }
  return Object.freeze({
    protocol: "kanvas.worker-adapter-result/v1" as const,
    capabilityOutput: value,
    outputs: Object.freeze([]),
  });
}

export class WorkflowWakeupProcessor {
  readonly #runtime: ApplicationRuntime;
  readonly #engine: WorkflowEngineStore;
  readonly #boundedOrchestrator: BoundedWorkflowOrchestratorStore;
  readonly #orchestrationRouting: WorkflowOrchestrationRoutingStore;
  readonly #now: () => Date;

  public constructor(dependencies: WorkflowWakeupProcessorDependencies) {
    this.#runtime = dependencies.runtime;
    this.#engine = dependencies.engine;
    this.#boundedOrchestrator = dependencies.boundedOrchestrator;
    this.#orchestrationRouting = dependencies.orchestrationRouting;
    this.#now = dependencies.now ?? (() => new Date());
  }

  public async handle(
    value: unknown,
  ): Promise<Readonly<Record<string, unknown>>> {
    const parsed = parseWorkflowOrchestrationDelivery(value);
    const { payload } = parsed;
    const receivedAt = this.#now();
    const delivery = {
      ...parsed.delivery,
      receivedAt,
    };
    const routing = await this.#orchestrationRouting.read(
      parsed.delivery.workspaceId,
      payload.workflowRunId,
    );
    if (!routing) {
      throw new Error("Workflow orchestration routing fact is missing.");
    }

    if (payload.messageType === "workflow.cancel.requested") {
      await this.#runtime.runtimeFence.assertAllowed({
        action: "cancel",
        expectedGeneration: payload.expectedGeneration,
      });
      const result = await this.#engine.consumeWorkflowCancellationSettlement({
        workflowRunId: payload.workflowRunId,
        now: receivedAt,
        executionGeneration: payload.expectedGeneration,
        delivery,
      });
      return Object.freeze({
        finished: false,
        cancellationSettled:
          result.deliveryStatus === "processed" && result.value,
        deliveryStatus: result.deliveryStatus,
        resultCode: result.resultCode,
      });
    }

    if (!requiresCancellationSettlement(payload.messageType, routing)) {
      await this.#runtime.runtimeFence.assertAllowed({
        action:
          payload.messageType === "workflow.wakeup.requested"
            ? "claim"
            : "complete",
        expectedGeneration: payload.expectedGeneration,
      });
      const result = await this.#boundedOrchestrator.consumeFrontier({
        workflowRunId: payload.workflowRunId,
        executionGeneration: payload.expectedGeneration,
        now: receivedAt,
        delivery,
      });
      return Object.freeze({
        protocolVersion: 1,
        deliveryStatus: result.deliveryStatus,
        resultCode: result.resultCode,
        ...(result.deliveryStatus === "processed"
          ? {
              lifecycleStatus: result.value.lifecycleStatus,
              transitions: result.value.transitions,
              nodeCreates: result.value.nodeCreates,
              continuationScheduled: result.value.continuationScheduled,
            }
          : {}),
      });
    }

    if (
      payload.messageType !== "capability.run.completed" &&
      payload.messageType !== "capability.run.failed" &&
      payload.messageType !== "capability.run.cancelled"
    ) {
      throw new PermanentInboxDeliveryError(
        "delivery.workflow_protocol_mismatch",
      );
    }
    await this.#runtime.runtimeFence.assertAllowed({
      action:
        payload.messageType === "capability.run.cancelled"
          ? "cancel"
          : "complete",
      expectedGeneration: payload.expectedGeneration,
    });
    const result = await this.#engine.consumeCancellationCapabilityTerminal({
      workflowRunId: payload.workflowRunId,
      nodeRunId: payload.nodeRunId,
      capabilityRunId: payload.capabilityRunId,
      now: receivedAt,
      executionGeneration: payload.expectedGeneration,
      delivery,
    });
    if (result.deliveryStatus === "duplicate") {
      return Object.freeze({
        finished: false,
        cancellationSettled: false,
        deliveryStatus: result.deliveryStatus,
        resultCode: result.resultCode,
      });
    }
    return Object.freeze({
      ...result.value,
      deliveryStatus: result.deliveryStatus,
      resultCode: result.resultCode,
    });
  }
}

function requiresCancellationSettlement(
  messageType:
    | "capability.run.completed"
    | "capability.run.failed"
    | "capability.run.cancelled"
    | "approval.decision.recorded"
    | "workflow.wakeup.requested",
  routing: WorkflowOrchestrationRoutingFact,
): boolean {
  return (
    (messageType === "capability.run.completed" ||
      messageType === "capability.run.failed" ||
      messageType === "capability.run.cancelled") &&
    routing.lifecycleStatus === "cancelling" &&
    routing.cancelReasonCode !== "workflow.timeout"
  );
}

export class AttemptDispatchProcessor {
  readonly #runtime: ApplicationRuntime;
  readonly #engine: WorkflowEngineStore;
  readonly #completions: AtomicAttemptCompletionStore;
  readonly #failures: AttemptFailureStore;
  readonly #nextId: () => string;
  readonly #now: () => Date;
  readonly #executeAdapter: WorkerAdapterExecutor;
  readonly #inputArtifactResolver: WorkerInputArtifactResolver | undefined;
  readonly #modelResourceResolver: WorkerModelResourceResolver | undefined;
  readonly #outputMaterializer: WorkerAttemptOutputMaterializer | undefined;
  readonly #leaseDurationMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #attemptTimeoutMs: number;

  public constructor(dependencies: AttemptProcessorDependencies) {
    this.#runtime = dependencies.runtime;
    this.#engine = dependencies.engine;
    this.#completions = dependencies.completions;
    this.#failures = dependencies.failures;
    this.#nextId = dependencies.nextId;
    this.#now = dependencies.now ?? (() => new Date());
    this.#executeAdapter =
      dependencies.executeAdapter ?? builtInWorkerAdapters.execute;
    this.#inputArtifactResolver = dependencies.inputArtifactResolver;
    this.#modelResourceResolver = dependencies.modelResourceResolver;
    this.#outputMaterializer = dependencies.outputMaterializer;
    this.#leaseDurationMs = dependencies.leaseDurationMs ?? 30_000;
    this.#heartbeatIntervalMs = dependencies.heartbeatIntervalMs ?? 10_000;
    this.#attemptTimeoutMs = dependencies.attemptTimeoutMs ?? 5 * 60_000;
    if (
      this.#heartbeatIntervalMs >= this.#leaseDurationMs ||
      this.#leaseDurationMs > this.#attemptTimeoutMs
    ) {
      throw new RangeError(
        "Attempt heartbeat interval must be shorter than the lease, and the lease must not exceed the attempt timeout.",
      );
    }
  }

  public async handle(
    value: unknown,
  ): Promise<Readonly<Record<string, unknown>>> {
    const parsed = parseAttemptDispatchDelivery(value, "worker");
    const { payload } = parsed;
    await this.#runtime.runtimeFence.assertAllowed({
      action: "claim",
      expectedGeneration: payload.expectedGeneration,
    });

    const now = this.#now();
    const rawLeaseToken = randomBytes(32).toString("hex");
    const leaseTokenHash = createHash("sha256")
      .update(rawLeaseToken)
      .digest("hex");
    const claim = await this.#engine.claimAttempt({
      capabilityRunId: payload.capabilityRunId,
      attemptId: payload.attemptId,
      leaseTokenHash,
      now,
      leaseUntil: new Date(now.getTime() + this.#leaseDurationMs),
      executionGeneration: payload.expectedGeneration,
      expectedExecutionTarget: "worker",
      delivery: {
        ...parsed.delivery,
        receivedAt: now,
      },
    });
    const attempt =
      claim.deliveryStatus === "processed" ? claim.value : undefined;
    if (!attempt) {
      return Object.freeze({
        claimed: false,
        deliveryStatus: claim.deliveryStatus,
        resultCode: claim.resultCode,
      });
    }
    if (attempt.executionTarget !== "worker") {
      throw new PermanentInboxDeliveryError(
        "delivery.claimed_execution_target_mismatch",
      );
    }

    await this.#runtime.runtimeFence.assertAllowed({
      action: "dispatch",
      expectedGeneration: payload.expectedGeneration,
    });
    const started = await this.#engine.markAttemptStarted({
      capabilityRunId: payload.capabilityRunId,
      attemptId: payload.attemptId,
      leaseTokenHash,
      leaseGeneration: attempt.leaseGeneration,
      now: this.#now(),
    });
    if (!started) {
      throw new Error(
        "Capability dispatch was rejected because its execution lease was lost.",
      );
    }
    const heartbeat = new AttemptHeartbeat({
      intervalMs: this.#heartbeatIntervalMs,
      leaseDurationMs: this.#leaseDurationMs,
      now: this.#now,
      heartbeat: async ({ now: heartbeatNow, leaseUntil }) => {
        await this.#runtime.runtimeFence.assertAllowed({
          action: "heartbeat",
          expectedGeneration: payload.expectedGeneration,
        });
        return this.#engine.heartbeatAttempt({
          capabilityRunId: payload.capabilityRunId,
          attemptId: payload.attemptId,
          leaseTokenHash,
          leaseGeneration: attempt.leaseGeneration,
          now: heartbeatNow,
          leaseUntil,
        });
      },
    });
    heartbeat.start();
    let output: unknown;
    let completionOutputs: readonly AttemptCompletionOutput[] = Object.freeze(
      [],
    );
    let executionFailed = false;
    let executionError: unknown;
    const adapterStartedAt = performance.now();
    let adapterElapsedMilliseconds = 0;
    try {
      const adapterInput = executeCapabilityMappingPlanV1(
        attempt.compiledInputMapping,
        {
          input: attempt.input,
          configuration: attempt.implementationConfiguration,
        },
      );
      const adapterResult = normalizeAdapterResult(
        await this.#executeAdapter(
          attempt.adapterKey,
          adapterInput,
          heartbeat.signal,
          {
            workspaceId: attempt.workspaceId,
            invocationKind: attempt.invocationKind,
            ...(attempt.workflowRunId
              ? { workflowRunId: attempt.workflowRunId }
              : {}),
            ...(attempt.nodeRunId ? { nodeRunId: attempt.nodeRunId } : {}),
            capabilityRunId: attempt.capabilityRunId,
            attemptId: attempt.attemptId,
            implementationConfiguration: attempt.implementationConfiguration,
            runtimeAdapterRevisionId: attempt.runtimeAdapterRevisionId,
            runtimeAdapterRevisionDigest: attempt.runtimeAdapterRevisionDigest,
            runtimeAdapter: attempt.runtimeAdapter,
            inputArtifacts: this.#inputArtifactResolver
              ? this.#inputArtifactResolver.bind({
                  workspaceId: attempt.workspaceId,
                  capabilityRunId: attempt.capabilityRunId,
                  input: adapterInput,
                  signal: heartbeat.signal,
                })
              : createUnavailableWorkerInputArtifactAccess(),
            ...(attempt.modelResource && this.#modelResourceResolver
              ? {
                  modelResource: this.#modelResourceResolver.bind(
                    attempt.modelResource,
                  ),
                }
              : {}),
          },
        ),
      );
      if (adapterResult.outputs.length > 0 && !this.#outputMaterializer) {
        throw new Error(
          "Worker image outputs require a configured trusted Storage runtime.",
        );
      }
      completionOutputs =
        adapterResult.outputs.length === 0
          ? Object.freeze([])
          : await this.#outputMaterializer!.materialize({
              context: {
                workspaceId: attempt.workspaceId,
                actorId: attempt.actorId,
                attemptId: attempt.attemptId,
                executionDeadlineAt: attempt.executionDeadlineAt,
                executionTarget: "worker",
              },
              outputs: adapterResult.outputs,
              signal: heartbeat.signal,
            });
      const capabilityOutput = executeCapabilityMappingPlanV1(
        attempt.compiledOutputMapping,
        { result: adapterResult.capabilityOutput },
      );
      output = resolveAttemptOutputArtifactReferences(
        capabilityOutput,
        completionOutputs,
      );
      adapterElapsedMilliseconds = Math.max(
        0,
        performance.now() - adapterStartedAt,
      );
    } catch (error) {
      executionFailed = true;
      executionError = error;
    } finally {
      await heartbeat.stop();
    }
    try {
      heartbeat.assertOwned();
    } catch (error) {
      if (error instanceof AttemptCancellationRequestedError) {
        const cancelled = await this.#acknowledgeCancellation({
          payload,
          leaseTokenHash,
          leaseGeneration: attempt.leaseGeneration,
        });
        if (!cancelled) {
          throw new Error(
            "Capability cancellation acknowledgement was rejected because its execution lease was lost.",
            { cause: error },
          );
        }
        return Object.freeze({
          claimed: true,
          cancelled: true,
        });
      }
      throw error;
    }
    if (executionFailed) {
      await this.#runtime.runtimeFence.assertAllowed({
        action: "complete",
        expectedGeneration: payload.expectedGeneration,
      });
      const failure = normalizeAdapterFailure(executionError);
      let transition;
      try {
        transition = await this.#failures.reportAttemptFailure({
          workspaceId: attempt.workspaceId,
          capabilityRunId: payload.capabilityRunId,
          attemptId: payload.attemptId,
          nextAttemptId: this.#nextId(),
          outboxEventId: this.#nextId(),
          executionGeneration: payload.expectedGeneration,
          target: {
            reporter: "worker",
            executionTarget: "worker",
            implementationRevisionId: attempt.implementationRevisionId,
            implementationDigest: attempt.implementationDigest,
            adapterKey: attempt.adapterKey,
            attemptLeaseGeneration: attempt.leaseGeneration,
            domainLeaseTokenHash: leaseTokenHash,
          },
          failure: {
            stableErrorCode: failure.stableErrorCode,
            sideEffectState: failure.sideEffectState,
            retryability: failure.retryability,
            evidenceDigest: failure.evidenceDigest,
            stableIdempotencyKeyAvailable:
              failure.stableIdempotencyKeyAvailable,
            cause: "failed",
          },
          now: this.#now(),
        });
      } catch (error) {
        if (
          error instanceof AttemptFailureStoreError &&
          error.code === "attempt_failure.state_conflict"
        ) {
          throw new AttemptLeaseLostError(
            "Worker failure report lost its Attempt lease.",
          );
        }
        throw error;
      }
      if (transition.status === "cancelled") {
        const cancelled = await this.#acknowledgeCancellation({
          payload,
          leaseTokenHash,
          leaseGeneration: attempt.leaseGeneration,
        });
        if (cancelled) {
          return Object.freeze({
            claimed: true,
            cancelled: true,
          });
        }
        throw new AttemptLeaseLostError(
          "Worker failure report lost cancellation arbitration.",
        );
      }
      if (transition.status === "noop") {
        throw new AttemptLeaseLostError(
          "Worker failure report no longer owns the current Attempt.",
        );
      }
      return Object.freeze({
        claimed: true,
        retried: transition.status === "retried",
        fallback: transition.status === "fallback",
        failed:
          transition.status === "failed" || transition.status === "manual",
        manual: transition.status === "manual",
        reasonCode: transition.reasonCode,
        ...(transition.nextAttemptId
          ? { nextAttemptId: transition.nextAttemptId }
          : {}),
        ...(transition.nextExecutionTarget
          ? {
              nextExecutionTarget: transition.nextExecutionTarget,
            }
          : {}),
      });
    }
    await this.#runtime.runtimeFence.assertAllowed({
      action: "complete",
      expectedGeneration: payload.expectedGeneration,
    });
    try {
      const measuredImageUsage =
        completionOutputs.length > 0
          ? [
              {
                id: this.#nextId(),
                entryKey: "worker.image.wall_time",
                metricKey: "compute.wall_time",
                valueDimension: "quantity" as const,
                unitCode: "millisecond",
                entryKind: "observation" as const,
                sourceKind: "kanvas_measured" as const,
                numericValue: adapterElapsedMilliseconds.toFixed(3),
                evidenceDigest: `sha256:${createHash("sha256")
                  .update("kanvas:worker-image-usage:v1\0")
                  .update(attempt.runtimeAdapterRevisionDigest)
                  .update("\0")
                  .update(attempt.attemptId)
                  .update("\0")
                  .update(adapterElapsedMilliseconds.toFixed(3))
                  .digest("hex")}`,
                observedAt: this.#now(),
              },
            ]
          : [];
      await this.#completions.complete({
        workspaceId: attempt.workspaceId,
        capabilityRunId: payload.capabilityRunId,
        attemptId: payload.attemptId,
        completionId: this.#nextId(),
        terminalOutboxEventId: this.#nextId(),
        executionGeneration: payload.expectedGeneration,
        target: {
          executionTarget: "worker",
          implementationRevisionId: attempt.implementationRevisionId,
          implementationDigest: attempt.implementationDigest,
          adapterKey: attempt.adapterKey,
          attemptLeaseGeneration: attempt.leaseGeneration,
          domainLeaseTokenHash: leaseTokenHash,
        },
        capabilityOutput: output,
        outputs: completionOutputs,
        initialUsage: measuredImageUsage,
        now: this.#now(),
      });
    } catch (error) {
      const completionLostArbitration =
        error instanceof AtomicAttemptCompletionStoreError &&
        (error.code === "attempt_completion.state_conflict" ||
          error.code === "attempt_completion.lease_rejected");
      if (!completionLostArbitration) {
        throw error;
      }
      const cancelled = await this.#acknowledgeCancellation({
        payload,
        leaseTokenHash,
        leaseGeneration: attempt.leaseGeneration,
      });
      if (cancelled) {
        return Object.freeze({
          claimed: true,
          cancelled: true,
        });
      }
      throw new Error(
        "Capability completion was rejected because its execution lease was lost.",
        { cause: error },
      );
    }
    return Object.freeze({
      claimed: true,
      completed: true,
      output,
      deliveryStatus: claim.deliveryStatus,
      resultCode: claim.resultCode,
    });
  }

  async #acknowledgeCancellation(options: {
    readonly payload: AttemptDispatchRequestedPayload;
    readonly leaseTokenHash: string;
    readonly leaseGeneration: number;
  }): Promise<boolean> {
    await this.#runtime.runtimeFence.assertAllowed({
      action: "cancel",
      expectedGeneration: options.payload.expectedGeneration,
    });
    return this.#engine.acknowledgeAttemptCancellation({
      capabilityRunId: options.payload.capabilityRunId,
      attemptId: options.payload.attemptId,
      leaseTokenHash: options.leaseTokenHash,
      leaseGeneration: options.leaseGeneration,
      now: this.#now(),
      outboxEventId: this.#nextId(),
      executionGeneration: options.payload.expectedGeneration,
    });
  }
}

export class WorkflowCancellationProcessor {
  readonly #runtime: ApplicationRuntime;
  readonly #engine: WorkflowEngineStore;
  readonly #nextId: () => string;
  readonly #now: () => Date;

  public constructor(dependencies: ProcessorDependencies) {
    this.#runtime = dependencies.runtime;
    this.#engine = dependencies.engine;
    this.#nextId = dependencies.nextId;
    this.#now = dependencies.now ?? (() => new Date());
  }

  public async handle(
    value: unknown,
  ): Promise<Readonly<Record<string, unknown>>> {
    const parsed = parseWorkflowCancellationDelivery(value);
    const { payload } = parsed;
    await this.#runtime.runtimeFence.assertAllowed({
      action: "cancel",
      expectedGeneration: payload.expectedGeneration,
    });
    const now = this.#now();
    const result = await this.#engine.processWorkflowCancellation({
      workflowRunId: payload.workflowRunId,
      now,
      outboxEventId: this.#nextId(),
      executionGeneration: payload.expectedGeneration,
      delivery: {
        ...parsed.delivery,
        receivedAt: now,
      },
    });
    return Object.freeze({
      result: result.deliveryStatus === "processed" ? result.value : "noop",
      deliveryStatus: result.deliveryStatus,
      resultCode: result.resultCode,
    });
  }
}
