import { createHash } from "node:crypto";

import type {
  AttemptFailureRetryability,
  AttemptSideEffectState,
} from "@kanvas/database/runtime";

import { WorkerAttemptOutputMaterializationError } from "../storage/worker-attempt-output-materializer.js";
import { WorkerInputArtifactResolutionError } from "../storage/worker-input-artifact-resolver.js";
import { WorkerAdapterNotApplicableError } from "../adapter/worker-adapter.js";

export interface AdapterFailureOptions {
  readonly stableErrorCode: string;
  readonly sideEffectState: AttemptSideEffectState;
  readonly retryability: AttemptFailureRetryability;
  readonly evidenceDigest: string;
  readonly stableIdempotencyKeyAvailable?: boolean;
  readonly message?: string;
}

const stableCodePattern = /^[a-z0-9][a-z0-9._:-]{0,119}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

/**
 * Trusted Adapter failure envelope. Adapters must classify the external
 * effect boundary explicitly; arbitrary thrown values never inherit these
 * retry permissions.
 */
export class AdapterFailure extends Error {
  public readonly stableErrorCode: string;
  public readonly sideEffectState: AttemptSideEffectState;
  public readonly retryability: AttemptFailureRetryability;
  public readonly evidenceDigest: string;
  public readonly stableIdempotencyKeyAvailable: boolean;

  public constructor(options: AdapterFailureOptions) {
    if (
      !stableCodePattern.test(options.stableErrorCode) ||
      !digestPattern.test(options.evidenceDigest)
    ) {
      throw new TypeError(
        "AdapterFailure requires a stable error code and canonical evidence digest.",
      );
    }
    super(options.message ?? options.stableErrorCode);
    this.name = "AdapterFailure";
    this.stableErrorCode = options.stableErrorCode;
    this.sideEffectState = options.sideEffectState;
    this.retryability = options.retryability;
    this.evidenceDigest = options.evidenceDigest;
    this.stableIdempotencyKeyAvailable =
      options.stableIdempotencyKeyAvailable ?? false;
  }
}

export function normalizeAdapterFailure(error: unknown): AdapterFailure {
  if (error instanceof AdapterFailure) {
    return error;
  }
  if (error instanceof WorkerAdapterNotApplicableError) {
    return new AdapterFailure({
      stableErrorCode: error.stableErrorCode,
      sideEffectState: "not_started",
      retryability: "retryable",
      evidenceDigest: `sha256:${createHash("sha256")
        .update(`worker.adapter.not_applicable:${error.stableErrorCode}`)
        .digest("hex")}`,
      message:
        "The Worker Implementation is not applicable to this pinned business intent.",
    });
  }
  if (error instanceof WorkerInputArtifactResolutionError) {
    const causeKind =
      error.cause instanceof Error ? error.cause.name : typeof error.cause;
    const evidenceDigest = `sha256:${createHash("sha256")
      .update(`worker.input_artifact_resolution:${error.stage}:${causeKind}`)
      .digest("hex")}`;
    const terminal = error.stage === "validate" || error.stage === "authorize";
    const unavailable = error.stage === "unavailable";
    let retryability: "manual" | "retryable" | "terminal" = "retryable";
    if (terminal) {
      retryability = "terminal";
    } else if (unavailable) {
      retryability = "manual";
    }
    return new AdapterFailure({
      stableErrorCode: `worker.input_artifact_resolution.${error.stage}_failed`,
      sideEffectState: "not_started",
      retryability,
      evidenceDigest,
      message: "Worker input Artifact resolution failed.",
    });
  }
  if (error instanceof WorkerAttemptOutputMaterializationError) {
    const causeKind =
      error.cause instanceof Error ? error.cause.name : typeof error.cause;
    const evidenceDigest = `sha256:${createHash("sha256")
      .update(`worker.output_materialization:${error.stage}:${causeKind}`)
      .digest("hex")}`;
    return new AdapterFailure({
      stableErrorCode: `worker.output_materialization.${error.stage}_failed`,
      sideEffectState: error.stage === "validate" ? "not_started" : "started",
      retryability: error.stage === "validate" ? "terminal" : "retryable",
      evidenceDigest,
      stableIdempotencyKeyAvailable: error.stage !== "validate",
      message: "Worker Attempt output materialization failed.",
    });
  }
  const errorKind = error instanceof Error ? error.name : typeof error;
  const evidenceDigest = `sha256:${createHash("sha256")
    .update(`worker.adapter.unclassified:${errorKind}`)
    .digest("hex")}`;
  return new AdapterFailure({
    stableErrorCode: "worker.adapter.unclassified",
    sideEffectState: "unknown",
    retryability: "manual",
    evidenceDigest,
    message: "Worker Adapter failed without a trusted failure envelope.",
  });
}
