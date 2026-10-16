export interface WorkerProcessResources {
  stopClaiming(): Promise<void>;
  stopHealth(): Promise<void>;
  closeApplication(): Promise<void>;
  closeRedis(): void;
  closeDatabase(): Promise<void>;
  shutdownTelemetry(): Promise<void>;
}

export class WorkerProcessLifecycle {
  #shuttingDown = false;

  public constructor(private readonly resources: WorkerProcessResources) {}

  public get isShuttingDown(): boolean {
    return this.#shuttingDown;
  }

  public async shutdown(): Promise<void> {
    if (this.#shuttingDown) {
      return;
    }
    this.#shuttingDown = true;

    const errors: unknown[] = [];
    const run = async (operation: () => Promise<void>): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        errors.push(error);
      }
    };

    await run(() => this.resources.stopClaiming());
    await run(() => this.resources.stopHealth());
    await run(() => this.resources.closeApplication());
    await run(() => {
      this.resources.closeRedis();
      return Promise.resolve();
    });
    await run(() => this.resources.closeDatabase());
    await run(() => this.resources.shutdownTelemetry());

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "Worker shutdown completed with errors.",
      );
    }
  }
}
