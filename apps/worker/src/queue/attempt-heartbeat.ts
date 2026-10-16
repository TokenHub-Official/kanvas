export class AttemptLeaseLostError extends Error {
  public constructor(
    message = "Capability execution lease could not be renewed.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AttemptLeaseLostError";
  }
}

export class AttemptCancellationRequestedError extends Error {
  public constructor(
    message = "Capability execution cancellation was requested.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AttemptCancellationRequestedError";
  }
}

export type AttemptHeartbeatResult =
  "renewed" | "cancel_requested" | "rejected";

export interface AttemptHeartbeatOptions {
  readonly heartbeat: (options: {
    readonly now: Date;
    readonly leaseUntil: Date;
  }) => Promise<AttemptHeartbeatResult>;
  readonly intervalMs: number;
  readonly leaseDurationMs: number;
  readonly now?: () => Date;
}

export class AttemptHeartbeat {
  readonly #heartbeat: AttemptHeartbeatOptions["heartbeat"];
  readonly #intervalMs: number;
  readonly #leaseDurationMs: number;
  readonly #now: () => Date;
  readonly #abortController = new AbortController();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | undefined;
  #interruptionError:
    AttemptLeaseLostError | AttemptCancellationRequestedError | undefined;
  #stopping = false;

  public constructor(options: AttemptHeartbeatOptions) {
    if (
      !Number.isSafeInteger(options.intervalMs) ||
      options.intervalMs <= 0 ||
      !Number.isSafeInteger(options.leaseDurationMs) ||
      options.leaseDurationMs <= options.intervalMs
    ) {
      throw new RangeError(
        "Attempt heartbeat interval must be positive and shorter than the lease duration.",
      );
    }
    this.#heartbeat = options.heartbeat;
    this.#intervalMs = options.intervalMs;
    this.#leaseDurationMs = options.leaseDurationMs;
    this.#now = options.now ?? (() => new Date());
  }

  public get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  public start(): void {
    if (
      this.#timer ||
      this.#running ||
      this.#stopping ||
      this.#interruptionError
    ) {
      return;
    }
    this.#schedule();
  }

  public async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#running;
  }

  public assertOwned(): void {
    if (this.#interruptionError) {
      throw this.#interruptionError;
    }
  }

  public async runOnce(): Promise<boolean> {
    if (this.#interruptionError || this.#stopping) {
      return false;
    }
    const now = this.#now();
    try {
      const result = await this.#heartbeat({
        now,
        leaseUntil: new Date(now.getTime() + this.#leaseDurationMs),
      });
      if (result === "renewed") {
        return true;
      }
      if (result === "cancel_requested") {
        this.#interrupt(new AttemptCancellationRequestedError());
      } else {
        this.#interrupt(
          new AttemptLeaseLostError(
            "Capability execution lease renewal was rejected.",
          ),
        );
      }
      return false;
    } catch (error) {
      this.#interrupt(
        error instanceof AttemptLeaseLostError ||
          error instanceof AttemptCancellationRequestedError
          ? error
          : new AttemptLeaseLostError(
              "Capability execution lease renewal failed.",
              { cause: error },
            ),
      );
      return false;
    }
  }

  #schedule(): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#running = this.runOnce()
        .then(() => undefined)
        .finally(() => {
          this.#running = undefined;
          if (!this.#stopping && !this.#interruptionError) {
            this.#schedule();
          }
        });
    }, this.#intervalMs);
    this.#timer.unref?.();
  }

  #interrupt(
    error: AttemptLeaseLostError | AttemptCancellationRequestedError,
  ): void {
    if (this.#interruptionError) {
      return;
    }
    this.#interruptionError = error;
    this.#abortController.abort(error);
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }
}
