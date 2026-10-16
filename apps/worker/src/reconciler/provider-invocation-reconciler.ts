import {
  RuntimeFenceRejectedError,
  type ApplicationRuntime,
  type RuntimeStateReader,
} from "@kanvas/application";
import type {
  BudgetReservationStore,
  ProviderExecutionContextStore,
  ProviderInvocationStore,
  ProviderInvocationClaim,
  ProviderRecoveryCandidate,
} from "@kanvas/database/runtime";
import type { Logger } from "pino";

import {
  ProviderAdapterCallError,
  type ProviderAdapterRegistry,
} from "../provider/provider-adapter.js";
import { createProviderInvocationLeaseTokenHash } from "../provider/provider-attempt-processor.js";
import { ProviderInvocationRunner } from "../provider/provider-invocation-runner.js";
import type { ProviderSecretMaterialResolver } from "../provider/provider-secret-resolver.js";
import type { WorkerAttemptOutputMaterializer } from "../storage/worker-attempt-output-materializer.js";
import type { WorkerInputArtifactResolver } from "../storage/worker-input-artifact-resolver.js";

export interface ProviderInvocationReconcilerOptions {
  readonly runtime: ApplicationRuntime;
  readonly runtimeStateReader: RuntimeStateReader;
  readonly store: ProviderInvocationStore;
  readonly preflight?: (claim: ProviderInvocationClaim) => Promise<void>;
  readonly executionContexts?: ProviderExecutionContextStore;
  readonly secretResolver?: ProviderSecretMaterialResolver;
  readonly budgets?: BudgetReservationStore;
  readonly inputArtifactResolver?: WorkerInputArtifactResolver;
  readonly outputMaterializer?: WorkerAttemptOutputMaterializer;
  readonly adapters: ProviderAdapterRegistry;
  readonly logger: Pick<Logger, "error">;
  readonly nextId: () => string;
  readonly now?: () => Date;
  readonly batchSize?: number;
  readonly leaseDurationMs?: number;
  readonly reconcileDelayMs?: number;
  readonly pollIntervalMs?: number;
  readonly concurrency?: number;
}

export interface ProviderInvocationReconciliationSummary {
  readonly scanned: number;
  readonly claimed: number;
  readonly observed: number;
  readonly noop: number;
  readonly failed: number;
}

function assertBatchSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new RangeError(
      "Provider reconciliation batch size must be between 1 and 100.",
    );
  }
}

function assertLeaseDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000) {
    throw new RangeError(
      "Provider reconciliation lease must be between 1 and 3600000 milliseconds.",
    );
  }
}

function candidateLogFields(
  candidate: ProviderRecoveryCandidate,
): Readonly<Record<string, string>> {
  return {
    reconciliationKind: "provider_invocation",
    invocationId: candidate.invocationId,
    recoveryReason: candidate.reason,
  };
}

/**
 * Performs one bounded Provider recovery batch. Scheduling belongs to the
 * process composition root; this class intentionally owns no timer or loop.
 */
export class ProviderInvocationReconciler {
  readonly #runtime: ApplicationRuntime;
  readonly #runtimeStateReader: RuntimeStateReader;
  readonly #store: ProviderInvocationStore;
  readonly #logger: Pick<Logger, "error">;
  readonly #nextId: () => string;
  readonly #now: () => Date;
  readonly #batchSize: number;
  readonly #leaseDurationMs: number;
  readonly #pollIntervalMs: number;
  readonly #runner: ProviderInvocationRunner;
  readonly #concurrency: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<unknown> | undefined;
  #stopping = false;

  public constructor(options: ProviderInvocationReconcilerOptions) {
    this.#runtime = options.runtime;
    this.#runtimeStateReader = options.runtimeStateReader;
    this.#store = options.store;
    this.#logger = options.logger;
    this.#nextId = options.nextId;
    this.#now = options.now ?? (() => new Date());
    this.#batchSize = options.batchSize ?? 20;
    this.#leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.#concurrency = options.concurrency ?? 4;
    assertBatchSize(this.#concurrency);
    assertBatchSize(this.#batchSize);
    assertLeaseDuration(this.#leaseDurationMs);
    assertLeaseDuration(this.#pollIntervalMs);
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
        ? {
            inputArtifactResolver: options.inputArtifactResolver,
          }
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

  public async runOnce(): Promise<ProviderInvocationReconciliationSummary> {
    const now = this.#now();
    const snapshot = await this.#runtimeStateReader.read();
    await this.#runtime.runtimeFence.assertAllowed({
      action: "repair",
      expectedGeneration: snapshot.executionGeneration,
    });
    const candidates = await this.#store.scanRecoveryCandidates({
      now,
      batchSize: this.#batchSize,
    });
    const summary = {
      scanned: candidates.length,
      claimed: 0,
      observed: 0,
      noop: 0,
      failed: 0,
    };

    const pending = [...candidates];
    let fenced = false;
    const drain = async (): Promise<void> => {
      while (!fenced && !this.#stopping) {
        const candidate = pending.shift();
        if (!candidate) return;
        try {
          await this.#runtime.runtimeFence.assertAllowed({
            action: "repair",
            expectedGeneration: snapshot.executionGeneration,
          });
          const claimedAt = this.#now();
          const leaseTokenHash = createProviderInvocationLeaseTokenHash();
          const terminalRecovery =
            candidate.reason === "cancel_deadline" ||
            candidate.reason === "execution_deadline";
          const claim = await this.#store.claimRecovery({
            invocationId: candidate.invocationId,
            leaseTokenHash,
            now: claimedAt,
            leaseUntil: new Date(claimedAt.getTime() + this.#leaseDurationMs),
            executionGeneration: snapshot.executionGeneration,
            ...(terminalRecovery
              ? { terminalOutboxEventId: this.#nextId() }
              : {}),
          });
          if (!claim) {
            summary.noop += 1;
            continue;
          }
          summary.claimed += 1;
          const result = await this.#runner.run({
            claim,
            leaseTokenHash,
            source: "reconciler",
          });
          if (result.executionStatus === "lease_lost") {
            summary.noop += 1;
          } else {
            summary.observed += 1;
          }
        } catch (error) {
          if (error instanceof RuntimeFenceRejectedError) {
            fenced = true;
            throw error;
          }
          summary.failed += 1;
          this.#logger.error(
            {
              ...candidateLogFields(candidate),
              errorCode: "provider.reconciliation.candidate_failed",
              errorType: error instanceof Error ? error.name : "unknown",
              ...(error instanceof ProviderAdapterCallError
                ? {
                    providerErrorCode: error.stableErrorCode,
                    providerCallEffect: error.effect,
                    ...(error.stage ? { providerCallStage: error.stage } : {}),
                  }
                : {}),
            },
            "Provider reconciliation candidate failed; continuing.",
          );
        }
      }
    };
    // Wait for every owned operation before propagating a runtime fence failure.
    const workers = await Promise.allSettled(
      Array.from(
        { length: Math.min(this.#concurrency, candidates.length) },
        drain,
      ),
    );
    for (const worker of workers) {
      if (worker.status === "rejected") throw worker.reason;
    }

    return Object.freeze(summary);
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#running = this.runOnce()
        .catch((error: unknown) => {
          this.#logger.error(
            {
              errorCode: "provider.reconciliation.iteration_failed",
              errorType: error instanceof Error ? error.name : "unknown",
            },
            "Provider reconciliation iteration failed.",
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
