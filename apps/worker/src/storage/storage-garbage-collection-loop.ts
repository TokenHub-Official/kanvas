import type {
  ApplicationRuntime,
  RuntimeStateReader,
} from "@kanvas/application";
import type { StorageGarbageCollectionCoordinator } from "@kanvas/storage";
import type { Logger } from "pino";

export interface StorageGarbageCollectionLoopOptions {
  readonly runtime: ApplicationRuntime;
  readonly runtimeStateReader: RuntimeStateReader;
  readonly coordinator: StorageGarbageCollectionCoordinator;
  readonly logger: Pick<Logger, "error">;
  readonly pollIntervalMs: number;
  readonly reconcileProviderCleanup?: () => Promise<void>;
}

function assertPollInterval(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000) {
    throw new RangeError(
      "Storage garbage collection poll interval must be between 1 and 3600000 milliseconds.",
    );
  }
}

export class StorageGarbageCollectionLoop {
  readonly #runtime: ApplicationRuntime;
  readonly #runtimeStateReader: RuntimeStateReader;
  readonly #coordinator: StorageGarbageCollectionCoordinator;
  readonly #logger: Pick<Logger, "error">;
  readonly #pollIntervalMs: number;
  readonly #reconcileProviderCleanup: (() => Promise<void>) | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<unknown> | undefined;
  #stopping = false;

  public constructor(options: StorageGarbageCollectionLoopOptions) {
    assertPollInterval(options.pollIntervalMs);
    this.#reconcileProviderCleanup = options.reconcileProviderCleanup;
    this.#runtime = options.runtime;
    this.#runtimeStateReader = options.runtimeStateReader;
    this.#coordinator = options.coordinator;
    this.#logger = options.logger;
    this.#pollIntervalMs = options.pollIntervalMs;
  }

  public start(): void {
    if (this.#timer || this.#running) {
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

  public async runOnce(): Promise<void> {
    const snapshot = await this.#runtimeStateReader.read();
    await this.#runtime.runtimeFence.assertAllowed({
      action: "garbage-collect",
      expectedGeneration: snapshot.executionGeneration,
    });
    await this.#coordinator.runNext();
    await this.#reconcileProviderCleanup?.();
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#running = this.runOnce()
        .catch((error: unknown) => {
          this.#logger.error(
            {
              errorCode: "storage.gc.iteration_failed",
              errorType: error instanceof Error ? error.name : "unknown",
            },
            "Storage garbage collection iteration failed.",
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
