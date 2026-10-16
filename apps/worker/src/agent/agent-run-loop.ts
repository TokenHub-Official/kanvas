import type { Logger } from "pino";

import type { AgentRunProcessor } from "./agent-run-processor.js";

export class AgentRunLoop {
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #active = new Set<Promise<void>>();
  #stopped = true;

  public constructor(
    private readonly options: {
      readonly processor: Pick<AgentRunProcessor, "processNext">;
      readonly logger: Pick<Logger, "error">;
      readonly pollIntervalMs: number;
      readonly concurrency: number;
      readonly canClaim: () => Promise<boolean>;
    },
  ) {}

  public start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    for (let lane = 0; lane < this.options.concurrency; lane += 1)
      this.#schedule(0);
  }

  public async stop(): Promise<void> {
    this.#stopped = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    await Promise.allSettled(this.#active);
  }

  #schedule(delay: number): void {
    if (this.#stopped) return;
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      const active = this.#tick().finally(() => {
        this.#active.delete(active);
        this.#schedule(this.options.pollIntervalMs);
      });
      this.#active.add(active);
    }, delay);
    this.#timers.add(timer);
  }

  async #tick(): Promise<void> {
    try {
      // Each lane refills independently; a slow run cannot hold idle lanes.
      // Eight is a scheduling batch size, never a limit on a Run's work.
      for (let index = 0; index < 8 && !this.#stopped; index += 1) {
        if (!(await this.options.canClaim()) || this.#stopped) return;
        if (!(await this.options.processor.processNext())) return;
      }
    } catch (error) {
      this.options.logger.error(
        {
          errorType: error instanceof Error ? error.name : "UnknownError",
          errorMessage:
            error instanceof Error ? error.message : "Agent Run loop failed.",
        },
        "Agent Run loop failed.",
      );
    }
  }
}
