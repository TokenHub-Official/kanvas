import { createHash } from "node:crypto";

export type ArtifactPreviewMode = "async_persisted" | "on_demand";

export interface ArtifactPreviewConfig {
  readonly mode: ArtifactPreviewMode;
  readonly fallbackOnMiss: boolean;
  readonly width: number;
  readonly height: number;
  readonly quality: number;
  readonly effort: number;
  readonly maximumSourceBytes: number;
  readonly workerConcurrency: number;
  readonly generationAttempts: number;
  readonly generationRetryMs: number;
  readonly cleanupPollIntervalMs: number;
  readonly cleanupRetryMs: number;
  readonly variantKey: "interactive-preview";
  readonly profileVersion: string;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value?.trim() || String(fallback));
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
  return parsed;
}

function booleanValue(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (!value?.trim()) return fallback;
  if (value?.trim() === "true") return true;
  if (value?.trim() === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function previewMode(value: string | undefined): ArtifactPreviewMode {
  if (!value?.trim() || value === "on_demand") {
    return "on_demand";
  }
  if (value === "async_persisted") return value;
  throw new Error(
    "KANVAS_ARTIFACT_PREVIEW_MODE must be on_demand or async_persisted.",
  );
}

export function loadArtifactPreviewConfig(
  environment: NodeJS.ProcessEnv,
): ArtifactPreviewConfig {
  const mode = previewMode(environment.KANVAS_ARTIFACT_PREVIEW_MODE);
  const fallbackOnMiss = booleanValue(
    environment.KANVAS_ARTIFACT_PREVIEW_FALLBACK_ON_MISS,
    true,
    "KANVAS_ARTIFACT_PREVIEW_FALLBACK_ON_MISS",
  );
  const width = boundedInteger(
    environment.KANVAS_ARTIFACT_PREVIEW_WIDTH,
    640,
    "KANVAS_ARTIFACT_PREVIEW_WIDTH",
    64,
    2_048,
  );
  const height = boundedInteger(
    environment.KANVAS_ARTIFACT_PREVIEW_HEIGHT,
    640,
    "KANVAS_ARTIFACT_PREVIEW_HEIGHT",
    64,
    2_048,
  );
  const quality = boundedInteger(
    environment.KANVAS_ARTIFACT_PREVIEW_QUALITY,
    80,
    "KANVAS_ARTIFACT_PREVIEW_QUALITY",
    1,
    100,
  );
  const effort = boundedInteger(
    environment.KANVAS_ARTIFACT_PREVIEW_EFFORT,
    4,
    "KANVAS_ARTIFACT_PREVIEW_EFFORT",
    0,
    6,
  );
  const maximumSourceBytes = boundedInteger(
    environment.KANVAS_ARTIFACT_PREVIEW_MAX_SOURCE_BYTES,
    40 * 1_024 * 1_024,
    "KANVAS_ARTIFACT_PREVIEW_MAX_SOURCE_BYTES",
    1_048_576,
    536_870_912,
  );
  const workerConcurrency = boundedInteger(
    environment.KANVAS_ARTIFACT_PREVIEW_WORKER_CONCURRENCY,
    2,
    "KANVAS_ARTIFACT_PREVIEW_WORKER_CONCURRENCY",
    1,
    16,
  );
  const generationAttempts = boundedInteger(
    environment.KANVAS_ARTIFACT_PREVIEW_GENERATION_ATTEMPTS,
    3,
    "KANVAS_ARTIFACT_PREVIEW_GENERATION_ATTEMPTS",
    1,
    10,
  );
  const generationRetryMs = boundedInteger(
    environment.KANVAS_ARTIFACT_PREVIEW_GENERATION_RETRY_MS,
    5_000,
    "KANVAS_ARTIFACT_PREVIEW_GENERATION_RETRY_MS",
    250,
    3_600_000,
  );
  const cleanupPollIntervalMs = boundedInteger(
    environment.KANVAS_ARTIFACT_PREVIEW_CLEANUP_POLL_INTERVAL_MS,
    30_000,
    "KANVAS_ARTIFACT_PREVIEW_CLEANUP_POLL_INTERVAL_MS",
    1_000,
    3_600_000,
  );
  const cleanupRetryMs = boundedInteger(
    environment.KANVAS_ARTIFACT_PREVIEW_CLEANUP_RETRY_MS,
    30_000,
    "KANVAS_ARTIFACT_PREVIEW_CLEANUP_RETRY_MS",
    1_000,
    3_600_000,
  );
  const variantKey = "interactive-preview" as const;
  const profileVersion = `artifact-preview-webp-v1:${createHash("sha256")
    .update(
      JSON.stringify({
        effort,
        height,
        quality,
        variantKey,
        width,
      }),
    )
    .digest("hex")}`;
  return Object.freeze({
    mode,
    fallbackOnMiss,
    width,
    height,
    quality,
    effort,
    maximumSourceBytes,
    workerConcurrency,
    generationAttempts,
    generationRetryMs,
    cleanupPollIntervalMs,
    cleanupRetryMs,
    variantKey,
    profileVersion,
  });
}
