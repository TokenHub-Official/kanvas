import { createAliyunOssStorageAdapter } from "./aliyun-oss-adapter.js";
import { createHash } from "node:crypto";

import type {
  StorageCompatibilityProbeRecord,
  StorageUploadStore,
} from "@kanvas/database";
import type { StoragePort, StorageProfileRegistry } from "@kanvas/application";

import { createLocalFilesystemStorageAdapter } from "./local-filesystem-adapter.js";
import { createAwsS3CompatibleStorageAdapter } from "./s3-compatible-adapter.js";
import {
  createServerStreamUploadCoordinator,
  type ServerStreamUploadCoordinator,
} from "./server-stream-upload-coordinator.js";
import { createStorageProfileRegistry } from "./storage-profile-registry.js";
import { runStorageCompatibilityProbe } from "./storage-compatibility-probe.js";
import type { TrustedImageStorageConfig } from "./trusted-image-storage-config.js";

export interface TrustedImageStorageRuntime {
  readonly profileId: string;
  readonly profileConfigurationHash: string;
  readonly container: string;
  readonly maximumInputBytes: number;
  readonly modelResourceMaximumInputBytes: number;
  readonly cleanupGraceMilliseconds: number;
  readonly verificationProfileVersion: "trusted-image-structural-v1";
  readonly profiles: StorageProfileRegistry;
  readonly uploads: ServerStreamUploadCoordinator;
  readonly ensureCompatibilityProbe: (
    workspaceId: string,
    probeId: string,
    now: Date,
  ) => Promise<StorageCompatibilityProbeRecord>;
  readonly close: () => Promise<void>;
  readonly reconcileCleanup?: () => Promise<void>;
}

export interface CreateTrustedImageStorageRuntimeOptions {
  readonly config: TrustedImageStorageConfig;
  readonly store: StorageUploadStore;
  readonly adapterVersion: string;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function utcMonthKey(now: Date): string {
  return `${String(now.getUTCFullYear()).padStart(4, "0")}-${String(
    now.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
}

function nextUtcMonth(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
}

export async function createTrustedImageStorageRuntime(
  options: CreateTrustedImageStorageRuntimeOptions,
): Promise<TrustedImageStorageRuntime> {
  const buildLegacyAdapter = async (): Promise<StoragePort> =>
    options.config.kind === "local"
      ? await createLocalFilesystemStorageAdapter({
          storageProfileId: options.config.profileId,
          rootDirectory: options.config.rootDirectory,
          acknowledgeTrustedProcessRoot: true,
        })
      : createAwsS3CompatibleStorageAdapter({
          ...(options.config.keyPrefix
            ? { keyPrefix: options.config.keyPrefix }
            : {}),
          storageProfileId: options.config.profileId,
          bucket: options.config.container,
          endpoint: options.config.endpoint,
          region: options.config.region,
          forcePathStyle:
            "forcePathStyle" in options.config
              ? options.config.forcePathStyle
              : false,
          encryption:
            "encryption" in options.config
              ? options.config.encryption
              : { mode: "none" },
          ...(options.config.kind === "s3" && options.config.credentials
            ? { credentials: options.config.credentials }
            : {}),
          ...(options.config.stagingDirectory
            ? {
                stagingDirectory: options.config.stagingDirectory,
              }
            : {}),
        });
  const adapter =
    options.config.kind === "oss"
      ? await createAliyunOssStorageAdapter({
          storageProfileId: options.config.profileId,
          bucket: options.config.container,
          endpoint: options.config.endpoint,
          region: options.config.region,
          keyPrefix: options.config.keyPrefix,
          ...options.config.credentials,
          ...(options.config.stagingDirectory
            ? { stagingDirectory: options.config.stagingDirectory }
            : {}),
        })
      : await buildLegacyAdapter();
  const evidence = await runStorageCompatibilityProbe(
    adapter,
    options.config.container,
  );
  const adapterKey = {
    local: "local-filesystem.v1",
    s3: "s3-compatible-server-owned.v1",
    oss: "aliyun-oss-fenced.v1",
  }[adapter.kind];
  const profiles = createStorageProfileRegistry([
    {
      storageProfileId: options.config.profileId,
      kind: adapter.kind,
      adapter,
    },
  ]);
  const uploads = createServerStreamUploadCoordinator({
    store: options.store,
    profiles,
    verificationLimits: options.config.verificationLimits,
    verificationLeaseMilliseconds: options.config.verificationLeaseMilliseconds,
  });
  const capabilities = Object.freeze({
    supportsConditionalCreate: adapter.kind !== "local",
    supportsServerOwnedWrite:
      adapter.capabilities.writeProtectionModes.includes("server_owned"),
    supportsMultipart: adapter.capabilities.multipart,
    supportsRangeRead: adapter.capabilities.rangeRead,
    supportsVersionBoundIdentity: adapter.capabilities.versionBoundIdentity,
    supportsFullObjectChecksum: adapter.capabilities.fullObjectChecksum,
    sealedIdentityImmutable: adapter.capabilities.sealedIdentityImmutable,
  });
  const resultHash = digest({
    contract: "kanvas.storage.compatibility.v1",
    adapterKey,
    adapterVersion: options.adapterVersion,
    profileConfigurationHash: options.config.profileConfigurationHash,
    capabilities,
    evidence,
  });

  return Object.freeze({
    reconcileCleanup: async () => {
      await adapter.reconcileCleanup?.();
    },
    profileId: options.config.profileId,
    profileConfigurationHash: options.config.profileConfigurationHash,
    container: options.config.container,
    maximumInputBytes: options.config.verificationLimits.maximumInputBytes,
    modelResourceMaximumInputBytes:
      options.config.modelResourceMaximumInputBytes,
    cleanupGraceMilliseconds: options.config.cleanupGraceMilliseconds,
    verificationProfileVersion: options.config.verificationProfileVersion,
    profiles,
    uploads,
    async close() {
      await adapter.close?.();
    },
    ensureCompatibilityProbe(workspaceId: string, probeId: string, now: Date) {
      const month = utcMonthKey(now);
      const validUntil = nextUtcMonth(now);
      const requestHash = digest({
        workspaceId,
        storageProfileId: options.config.profileId,
        profileConfigurationHash: options.config.profileConfigurationHash,
        adapterVersion: options.adapterVersion,
        month,
      });
      return options.store.recordCompatibilityProbe({
        id: probeId,
        workspaceId,
        // The replay key must cover every fact in requestHash. A monthly key
        // without the release/configuration conflicts after an in-month upgrade.
        probeKey: `storage-probe:v2:${requestHash}`,
        requestHash,
        storageProfileId: options.config.profileId,
        profileConfigurationHash: options.config.profileConfigurationHash,
        adapterKey,
        adapterVersion: options.adapterVersion,
        capabilityContractVersion: 1,
        capabilities,
        status: "passed",
        resultHash,
        evidence,
        testedAt: now,
        validUntil,
        createdAt: now,
      });
    },
  });
}
