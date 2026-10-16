import { describe, expect, it } from "vitest";

import { normalizeAdapterFailure } from "../src/queue/worker-adapter-failure.js";
import { WorkerInputArtifactResolutionError } from "../src/storage/worker-input-artifact-resolver.js";

describe("Worker Adapter failure normalization", () => {
  it("makes invalid or unauthorized input Artifacts terminal without leaking causes", () => {
    const failure = normalizeAdapterFailure(
      new WorkerInputArtifactResolutionError("authorize", "public message", {
        cause: new Error("database row and secret object key"),
      }),
    );

    expect(failure).toMatchObject({
      stableErrorCode: "worker.input_artifact_resolution.authorize_failed",
      sideEffectState: "not_started",
      retryability: "terminal",
      stableIdempotencyKeyAvailable: false,
    });
    expect(failure.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(failure)).not.toContain(
      "database row and secret object key",
    );
  });

  it("classifies transient input reads as retryable before execution side effects", () => {
    const failure = normalizeAdapterFailure(
      new WorkerInputArtifactResolutionError("read", "read failed"),
    );

    expect(failure).toMatchObject({
      stableErrorCode: "worker.input_artifact_resolution.read_failed",
      sideEffectState: "not_started",
      retryability: "retryable",
      stableIdempotencyKeyAvailable: false,
    });
  });
});
