import type { RuntimeConfigurationWorker } from "@kanvas/contracts/api";
import type { RuntimeConfigurationStore } from "@kanvas/database/runtime";

/** Reports what this process has actually read, not a fleet-wide activation claim. */
export class RuntimeConfigurationObserver {
  private timer?: ReturnType<typeof setInterval>;
  private pending: Promise<void> | undefined;
  constructor(
    private readonly store: Pick<
      RuntimeConfigurationStore,
      "readEffective" | "observeWorker"
    >,
    private readonly workerId: string,
    private readonly deployment: Omit<
      RuntimeConfigurationWorker["deployment"],
      "source"
    >,
    private readonly onError: () => void,
  ) {}
  private refresh(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const snapshot = await this.store.readEffective();
      await this.store.observeWorker({
        workerId: this.workerId,
        deployment: { ...this.deployment, source: snapshot.downloadSource },
        configurationVersion: snapshot.version,
        observedAt: new Date().toISOString(),
      });
    })()
      .catch(() => this.onError())
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, 30_000);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
  }
}
