import type { StorageUploadStore } from "@kanvas/database";
import {
  createServerStreamUploadCoordinator,
  createTrustedImageStorageRuntime,
  verifyOpaqueModelResource,
  verifyTrustedFont,
  verifyTrustedSvg,
  verifyLibraryText,
  verifyLibraryDocument,
  type ServerStreamUploadCoordinator,
  type TrustedImageStorageRuntime,
} from "@kanvas/storage";

import type { ServerConfig } from "../config.js";

export type ServerStorageRuntime = TrustedImageStorageRuntime &
  Readonly<{
    fontUploads: ServerStreamUploadCoordinator;
    libraryTextUploads: ServerStreamUploadCoordinator;
    libraryDocumentUploads: ServerStreamUploadCoordinator;
    modelUploads: ServerStreamUploadCoordinator;
    packageUploads: ServerStreamUploadCoordinator;
    modelResourceImportSessionTtlMilliseconds: number;
    vectorUploads: ServerStreamUploadCoordinator;
    userImportSessionTtlMilliseconds: number;
  }>;

export interface CreateServerStorageRuntimeOptions {
  readonly config: NonNullable<ServerConfig["storage"]>;
  readonly store: StorageUploadStore;
  readonly adapterVersion: string;
}

export async function createServerStorageRuntime(
  options: CreateServerStorageRuntimeOptions,
): Promise<ServerStorageRuntime> {
  const runtime = await createTrustedImageStorageRuntime(options);
  const libraryDocumentUploads = createServerStreamUploadCoordinator({
    store: options.store,
    profiles: runtime.profiles,
    verificationLimits: {
      ...options.config.verificationLimits,
      maximumInputBytes: 16 * 1024 * 1024,
    },
    verificationLeaseMilliseconds: options.config.verificationLeaseMilliseconds,
    mediaVerifier: verifyLibraryDocument,
  });
  const libraryTextUploads = createServerStreamUploadCoordinator({
    store: options.store,
    profiles: runtime.profiles,
    verificationLimits: {
      ...options.config.verificationLimits,
      maximumInputBytes: 128 * 1024,
    },
    verificationLeaseMilliseconds: options.config.verificationLeaseMilliseconds,
    mediaVerifier: verifyLibraryText,
  });
  const fontUploads = createServerStreamUploadCoordinator({
    store: options.store,
    profiles: runtime.profiles,
    verificationLimits: options.config.verificationLimits,
    verificationLeaseMilliseconds: options.config.verificationLeaseMilliseconds,
    mediaVerifier: verifyTrustedFont,
  });
  const vectorUploads = createServerStreamUploadCoordinator({
    store: options.store,
    profiles: runtime.profiles,
    verificationLimits: options.config.verificationLimits,
    verificationLeaseMilliseconds: options.config.verificationLeaseMilliseconds,
    mediaVerifier: verifyTrustedSvg,
  });
  const modelUploads = createServerStreamUploadCoordinator({
    store: options.store,
    profiles: runtime.profiles,
    verificationLimits: {
      ...options.config.verificationLimits,
      maximumInputBytes: options.config.modelResourceMaximumInputBytes,
    },
    verificationLeaseMilliseconds: options.config.verificationLeaseMilliseconds,
    mediaVerifier: verifyOpaqueModelResource,
  });
  const packageUploads = createServerStreamUploadCoordinator({
    store: options.store,
    profiles: runtime.profiles,
    verificationLimits: {
      ...options.config.verificationLimits,
      maximumInputBytes: 64 * 1024 * 1024,
    },
    verificationLeaseMilliseconds: options.config.verificationLeaseMilliseconds,
    mediaVerifier: verifyOpaqueModelResource,
  });
  return Object.freeze({
    ...runtime,
    fontUploads,
    libraryTextUploads,
    libraryDocumentUploads,
    modelUploads,
    packageUploads,
    modelResourceImportSessionTtlMilliseconds:
      options.config.modelResourceImportSessionTtlMilliseconds,
    vectorUploads,
    userImportSessionTtlMilliseconds:
      options.config.userImportSessionTtlMilliseconds,
  });
}
