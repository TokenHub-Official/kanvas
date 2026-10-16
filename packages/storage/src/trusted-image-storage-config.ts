import { createHash } from "node:crypto";

import type { TrustedImageVerificationLimits } from "./media-verifier.js";
import {
  loadStorageAdapterConfig,
  storageAdapterPublicConfiguration,
  type StorageAdapterConfig,
  type StorageEnvironment,
} from "./storage-runtime-config.js";

export type TrustedImageStorageConfig = StorageAdapterConfig &
  Readonly<{
    profileConfigurationHash: string;
    verificationProfileVersion: "trusted-image-structural-v1";
    verificationLeaseMilliseconds: number;
    cleanupGraceMilliseconds: number;
    modelResourceMaximumInputBytes: number;
    verificationLimits: TrustedImageVerificationLimits & {
      readonly requireDecodedVerification: false;
    };
  }>;

function parseBoundedInteger(
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

export function loadTrustedImageStorageConfig(
  environment: NodeJS.ProcessEnv,
  environmentName: StorageEnvironment,
): TrustedImageStorageConfig | undefined {
  const adapterConfig = loadStorageAdapterConfig(environment, environmentName);
  if (!adapterConfig) {
    return undefined;
  }
  const verificationLimits = Object.freeze({
    maximumInputBytes: parseBoundedInteger(
      environment.KANVAS_STORAGE_MAX_INPUT_BYTES,
      134_217_728,
      "KANVAS_STORAGE_MAX_INPUT_BYTES",
      1_048_576,
      536_870_912,
    ),
    maximumWidth: parseBoundedInteger(
      environment.KANVAS_STORAGE_MAX_IMAGE_WIDTH,
      32_768,
      "KANVAS_STORAGE_MAX_IMAGE_WIDTH",
      1,
      65_535,
    ),
    maximumHeight: parseBoundedInteger(
      environment.KANVAS_STORAGE_MAX_IMAGE_HEIGHT,
      32_768,
      "KANVAS_STORAGE_MAX_IMAGE_HEIGHT",
      1,
      65_535,
    ),
    maximumPixels: parseBoundedInteger(
      environment.KANVAS_STORAGE_MAX_IMAGE_PIXELS,
      134_217_728,
      "KANVAS_STORAGE_MAX_IMAGE_PIXELS",
      1,
      1_073_741_824,
    ),
    maximumDecodedBytes: parseBoundedInteger(
      environment.KANVAS_STORAGE_MAX_DECODED_BYTES,
      536_870_912,
      "KANVAS_STORAGE_MAX_DECODED_BYTES",
      1_048_576,
      2_147_483_647,
    ),
    maximumExpansionRatio: parseBoundedInteger(
      environment.KANVAS_STORAGE_MAX_EXPANSION_RATIO,
      2_048,
      "KANVAS_STORAGE_MAX_EXPANSION_RATIO",
      1,
      1_000_000,
    ),
    requireDecodedVerification: false as const,
  });
  const modelResourceMaximumInputBytes = parseBoundedInteger(
    environment.KANVAS_MODEL_RESOURCE_MAX_INPUT_BYTES,
    2_147_483_648,
    "KANVAS_MODEL_RESOURCE_MAX_INPUT_BYTES",
    1_048_576,
    5_368_709_120,
  );
  const profileConfigurationHash = `sha256:${createHash("sha256")
    .update("kanvas:storage-profile:v2\0")
    .update(
      JSON.stringify({
        ...storageAdapterPublicConfiguration(adapterConfig),
        verificationProfileVersion: "trusted-image-structural-v1",
        verificationLimits,
        modelResourceMaximumInputBytes,
      }),
    )
    .digest("hex")}`;
  return Object.freeze({
    ...adapterConfig,
    profileConfigurationHash,
    verificationProfileVersion: "trusted-image-structural-v1" as const,
    verificationLeaseMilliseconds: parseBoundedInteger(
      environment.KANVAS_STORAGE_VERIFICATION_LEASE_MS,
      120_000,
      "KANVAS_STORAGE_VERIFICATION_LEASE_MS",
      5_000,
      3_600_000,
    ),
    cleanupGraceMilliseconds: parseBoundedInteger(
      environment.KANVAS_STORAGE_CLEANUP_GRACE_MS,
      3_600_000,
      "KANVAS_STORAGE_CLEANUP_GRACE_MS",
      60_000,
      86_400_000,
    ),
    modelResourceMaximumInputBytes,
    verificationLimits,
  });
}
