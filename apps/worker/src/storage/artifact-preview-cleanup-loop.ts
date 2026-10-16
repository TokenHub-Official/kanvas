import { createHash, randomBytes } from "node:crypto";

import type { ArtifactRepresentationStore } from "@kanvas/database/runtime";
import type { TrustedImageStorageRuntime } from "@kanvas/storage";
import type { Logger } from "pino";

export interface ArtifactPreviewCleanupLoopOptions {
  readonly runtime: TrustedImageStorageRuntime;
  readonly store: ArtifactRepresentationStore;
  readonly logger: Pick<Logger, "error">;
  readonly pollIntervalMs: number;
  readonly retryMs: number;
}

export class ArtifactPreviewCleanupLoop {
  readonly #options: ArtifactPreviewCleanupLoopOptions;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | undefined;
  #stopping = false;

  public constructor(options: ArtifactPreviewCleanupLoopOptions) {
    this.#options = options;
  }

  public start(): void {
    if (!this.#timer && !this.#running) {
      this.#stopping = false;
      this.#schedule(0);
    }
  }

  public async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }

  public async runOnce(): Promise<void> {
    const now = new Date();
    const token = createHash("sha256").update(randomBytes(32)).digest("hex");
    const claim = await this.#options.store.claimNextCleanup({
      cleanupTokenHash: token,
      now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
    });
    if (!claim) return;
    try {
      const profile = this.#options.runtime.profiles.resolve(
        claim.storageProfileId,
      );
      if (!profile) throw new Error("Preview cleanup profile is unavailable.");
      const result = await profile.adapter.deleteObject({
        identity: {
          storageProfileId: claim.storageProfileId,
          container: claim.container,
          objectKey: claim.objectKey,
        },
        expectedByteSize: claim.byteSize,
        expectedSha256: claim.sha256,
        expectedImmutableIdentityHash: claim.immutableIdentityHash,
      });
      await this.#options.store.finalizeCleanupSuccess({
        id: claim.id,
        cleanupTokenHash: claim.cleanupTokenHash,
        result: result.disposition,
        now: new Date(),
      });
    } catch (error) {
      const errorCode =
        error instanceof Error ? error.name : "preview_cleanup_failed";
      await this.#options.store.finalizeCleanupFailure({
        id: claim.id,
        cleanupTokenHash: claim.cleanupTokenHash,
        errorCode,
        retryAt: new Date(Date.now() + this.#options.retryMs),
      });
      this.#options.logger.error(
        { errorCode },
        "Artifact preview cleanup failed.",
      );
    }
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#running = this.runOnce()
        .catch((error: unknown) => {
          this.#options.logger.error(
            { errorType: error instanceof Error ? error.name : "unknown" },
            "Artifact preview cleanup iteration failed.",
          );
        })
        .finally(() => {
          this.#running = undefined;
          if (!this.#stopping) this.#schedule(this.#options.pollIntervalMs);
        });
    }, delay);
  }
}
