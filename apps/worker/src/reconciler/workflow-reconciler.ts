import {
  RuntimeFenceRejectedError,
  type ApplicationRuntime,
  type RuntimeStateReader,
} from "@kanvas/application";
import type {
  ReconciliationCandidate,
  ReconciliationResult,
  WorkflowReconcilerStore,
} from "@kanvas/database/runtime";
import type { Logger } from "pino";

function candidateLogFields(
  candidate: ReconciliationCandidate,
): Readonly<Record<string, string>> {
  switch (candidate.kind) {
    case "workflow_wakeup":
    case "workflow_cancel":
      return {
        reconciliationKind: candidate.kind,
        workflowRunId: candidate.workflowRunId,
      };
    case "attempt_dispatch":
    case "expired_attempt":
      return {
        reconciliationKind: candidate.kind,
        capabilityRunId: candidate.capabilityRunId,
        attemptId: candidate.attemptId,
      };
    case "capability_terminal":
      return {
        reconciliationKind: candidate.kind,
        workflowRunId: candidate.workflowRunId,
        nodeRunId: candidate.nodeRunId,
        capabilityRunId: candidate.capabilityRunId,
      };
  }
}

export interface WorkflowReconcilerOptions {
  readonly runtime: ApplicationRuntime;
  readonly runtimeStateReader: RuntimeStateReader;
  readonly store: WorkflowReconcilerStore;
  readonly logger: Logger;
  readonly nextId: () => string;
  readonly now?: () => Date;
  readonly pollIntervalMs?: number;
  readonly staleAfterMs?: number;
  readonly batchSize?: number;
}

export class WorkflowReconciler {
  readonly #runtime: ApplicationRuntime;
  readonly #runtimeStateReader: RuntimeStateReader;
  readonly #store: WorkflowReconcilerStore;
  readonly #logger: Logger;
  readonly #nextId: () => string;
  readonly #now: () => Date;
  readonly #pollIntervalMs: number;
  readonly #staleAfterMs: number;
  readonly #batchSize: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<unknown> | undefined;
  #stopping = false;

  public constructor(options: WorkflowReconcilerOptions) {
    this.#runtime = options.runtime;
    this.#runtimeStateReader = options.runtimeStateReader;
    this.#store = options.store;
    this.#logger = options.logger;
    this.#nextId = options.nextId;
    this.#now = options.now ?? (() => new Date());
    this.#pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.#staleAfterMs = options.staleAfterMs ?? 15_000;
    this.#batchSize = options.batchSize ?? 20;
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

  public async runOnce(): Promise<
    Readonly<Record<ReconciliationResult, number>>
  > {
    const now = this.#now();
    const staleBefore = new Date(now.getTime() - this.#staleAfterMs);
    const snapshot = await this.#runtimeStateReader.read();
    await this.#runtime.runtimeFence.assertAllowed({
      action: "repair",
      expectedGeneration: snapshot.executionGeneration,
    });
    const candidates = await this.#store.scanCandidates({
      now,
      staleBefore,
      batchSize: this.#batchSize,
    });
    const counts: Record<ReconciliationResult, number> = {
      noop: 0,
      workflow_wakeup_rebuilt: 0,
      workflow_cancel_rebuilt: 0,
      attempt_dispatch_rebuilt: 0,
      capability_terminal_rebuilt: 0,
      attempt_retried: 0,
      attempt_fallback: 0,
      capability_failed: 0,
      capability_cancelled: 0,
    };

    for (const candidate of candidates) {
      await this.#runtime.runtimeFence.assertAllowed({
        action: "repair",
        expectedGeneration: snapshot.executionGeneration,
      });
      try {
        const common = {
          now: this.#now(),
          staleBefore,
          executionGeneration: snapshot.executionGeneration,
          outboxEventId: this.#nextId(),
        };
        let result: ReconciliationResult;
        switch (candidate.kind) {
          case "workflow_wakeup":
            result = await this.#store.reconcileWorkflowWakeup(
              candidate.workflowRunId,
              common,
            );
            break;
          case "workflow_cancel":
            result = await this.#store.reconcileWorkflowCancellation(
              candidate.workflowRunId,
              common,
            );
            break;
          case "attempt_dispatch":
            result = await this.#store.reconcileAttemptDispatch(
              candidate.capabilityRunId,
              candidate.attemptId,
              common,
            );
            break;
          case "capability_terminal":
            result = await this.#store.reconcileCapabilityTerminal(
              candidate.workflowRunId,
              candidate.nodeRunId,
              candidate.capabilityRunId,
              common,
            );
            break;
          case "expired_attempt":
            result = await this.#store.reconcileExpiredAttempt(
              candidate.capabilityRunId,
              candidate.attemptId,
              {
                ...common,
                nextAttemptId: this.#nextId(),
                browserAssignmentEventId: this.#nextId(),
              },
            );
            break;
        }
        counts[result] += 1;
        if (result !== "noop") {
          this.#logger.info(
            {
              reconciliationKind: candidate.kind,
              reconciliationResult: result,
            },
            "Workflow reconciliation repair committed.",
          );
        }
      } catch (error) {
        if (error instanceof RuntimeFenceRejectedError) {
          throw error;
        }
        this.#logger.error(
          {
            ...candidateLogFields(candidate),
            errorCode: "workflow.reconciliation.candidate_failed",
            errorType: error instanceof Error ? error.name : "unknown",
          },
          "Workflow reconciliation candidate failed; continuing.",
        );
      }
    }

    return Object.freeze(counts);
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#running = this.runOnce()
        .catch((error: unknown) => {
          this.#logger.error(
            {
              errorType: error instanceof Error ? error.name : "unknown",
              errorMessage:
                error instanceof Error
                  ? error.message
                  : "Unknown workflow reconciliation failure.",
            },
            "Workflow reconciler iteration failed.",
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
