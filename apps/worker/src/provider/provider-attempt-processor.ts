import { createHash, randomBytes } from "node:crypto";

import type { ApplicationRuntime } from "@kanvas/application";
import type {
  AttemptFailureStore,
  BudgetReservationStore,
  ProviderExecutionContextStore,
  ProviderInvocationStore,
  ProviderInvocationClaim,
} from "@kanvas/database/runtime";
import { ProviderInvocationStoreError } from "@kanvas/database/runtime";

import { parseAttemptDispatchDelivery } from "../queue/inbox-delivery.js";
import type { ProviderAdapterRegistry } from "./provider-adapter.js";
import { ProviderAdapterContractError } from "./provider-adapter.js";
import {
  ProviderInvocationRunner,
  type ProviderInvocationRunResult,
} from "./provider-invocation-runner.js";
import type { ProviderSecretMaterialResolver } from "./provider-secret-resolver.js";
import type { WorkerAttemptOutputMaterializer } from "../storage/worker-attempt-output-materializer.js";
import type { WorkerInputArtifactResolver } from "../storage/worker-input-artifact-resolver.js";

export interface ProviderAttemptProcessorOptions {
  readonly runtime: ApplicationRuntime;
  readonly store: ProviderInvocationStore;
  readonly preflight?: (claim: ProviderInvocationClaim) => Promise<void>;
  readonly executionContexts?: ProviderExecutionContextStore;
  readonly secretResolver?: ProviderSecretMaterialResolver;
  readonly budgets?: BudgetReservationStore;
  readonly attemptFailures?: AttemptFailureStore;
  readonly inputArtifactResolver?: WorkerInputArtifactResolver;
  readonly outputMaterializer?: WorkerAttemptOutputMaterializer;
  readonly adapters: ProviderAdapterRegistry;
  readonly nextId: () => string;
  readonly now?: () => Date;
  readonly leaseDurationMs?: number;
  readonly reconcileDelayMs?: number;
}

export type ProviderAttemptProcessorResult =
  | {
      readonly claimed: false;
      readonly deliveryStatus: "duplicate" | "processed";
      readonly resultCode: string;
    }
  | {
      readonly claimed: true;
      readonly invocationId: string;
      readonly run: ProviderInvocationRunResult;
      readonly deliveryStatus: "processed";
      readonly resultCode: string;
    };

function assertLeaseDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000) {
    throw new RangeError(
      "Provider invocation lease must be between 1 and 3600000 milliseconds.",
    );
  }
}

export function createProviderInvocationLeaseTokenHash(): string {
  const rawToken = randomBytes(32);
  return createHash("sha256").update(rawToken).digest("hex");
}

export class ProviderAttemptProcessor {
  readonly #runtime: ApplicationRuntime;
  readonly #store: ProviderInvocationStore;
  readonly #nextId: () => string;
  readonly #now: () => Date;
  readonly #leaseDurationMs: number;
  readonly #attemptFailures: AttemptFailureStore | undefined;
  readonly #runner: ProviderInvocationRunner;

  public constructor(options: ProviderAttemptProcessorOptions) {
    this.#runtime = options.runtime;
    this.#store = options.store;
    this.#nextId = options.nextId;
    this.#now = options.now ?? (() => new Date());
    this.#leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.#attemptFailures = options.attemptFailures;
    assertLeaseDuration(this.#leaseDurationMs);
    this.#runner = new ProviderInvocationRunner({
      runtime: options.runtime,
      store: options.store,
      ...(options.preflight ? { preflight: options.preflight } : {}),
      ...(options.executionContexts
        ? { executionContexts: options.executionContexts }
        : {}),
      ...(options.secretResolver
        ? { secretResolver: options.secretResolver }
        : {}),
      ...(options.budgets ? { budgets: options.budgets } : {}),
      ...(options.inputArtifactResolver
        ? { inputArtifactResolver: options.inputArtifactResolver }
        : {}),
      ...(options.outputMaterializer
        ? { outputMaterializer: options.outputMaterializer }
        : {}),
      adapters: options.adapters,
      nextId: options.nextId,
      now: this.#now,
      ...(options.reconcileDelayMs === undefined
        ? {}
        : { reconcileDelayMs: options.reconcileDelayMs }),
    });
  }

  public async handle(value: unknown): Promise<ProviderAttemptProcessorResult> {
    const parsed = parseAttemptDispatchDelivery(value, "provider");
    const { payload } = parsed;
    await this.#runtime.runtimeFence.assertAllowed({
      action: "claim",
      expectedGeneration: payload.expectedGeneration,
    });

    const now = this.#now();
    const invocationId = this.#nextId();
    const leaseTokenHash = createProviderInvocationLeaseTokenHash();
    let claimResult;
    try {
      claimResult = await this.#store.claimDispatch({
        invocationId,
        capabilityRunId: payload.capabilityRunId,
        attemptId: payload.attemptId,
        leaseTokenHash,
        now,
        leaseUntil: new Date(now.getTime() + this.#leaseDurationMs),
        executionGeneration: payload.expectedGeneration,
        delivery: {
          ...parsed.delivery,
          receivedAt: now,
        },
      });
    } catch (error) {
      if (
        !(error instanceof ProviderInvocationStoreError) ||
        error.code !== "provider_invocation.snapshot_invalid" ||
        !this.#attemptFailures
      ) {
        throw error;
      }
      const transition = await this.#attemptFailures.reportAttemptFailure({
        workspaceId: parsed.delivery.workspaceId,
        capabilityRunId: payload.capabilityRunId,
        attemptId: payload.attemptId,
        nextAttemptId: this.#nextId(),
        outboxEventId: this.#nextId(),
        executionGeneration: payload.expectedGeneration,
        target: {
          reporter: "reconciler",
          executionTarget: "provider",
          expectedAttemptVersion: parsed.delivery.aggregateVersion,
        },
        failure: {
          stableErrorCode: "provider.parameter_resolution_rejected",
          sideEffectState: "not_started",
          retryability: "terminal",
          cause: "failed",
        },
        now,
      });
      return Object.freeze({
        claimed: false,
        deliveryStatus: "processed",
        resultCode: `provider.dispatch.${transition.status}`,
      });
    }
    const claim =
      claimResult.deliveryStatus === "processed"
        ? claimResult.value
        : undefined;
    if (!claim) {
      return Object.freeze({
        claimed: false,
        deliveryStatus: claimResult.deliveryStatus,
        resultCode: claimResult.resultCode,
      });
    }
    if (claim.workKind !== "submit") {
      throw new ProviderAdapterContractError(
        "A provider dispatch must claim submit work.",
      );
    }

    const run = await this.#runner.run({
      claim,
      leaseTokenHash,
      source: "consumer",
    });
    return Object.freeze({
      claimed: true,
      invocationId: claim.invocationId,
      run,
      deliveryStatus: "processed",
      resultCode: claimResult.resultCode,
    });
  }
}
