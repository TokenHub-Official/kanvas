import type {
  ModelResourceImportSummary,
  ModelResourceMutationResult,
  ModelResourceSummary,
} from "@kanvas/contracts/api";
import {
  digestProviderValue,
  type ModelResourceImportRecord,
  type ModelResourceRecord,
} from "@kanvas/database/runtime";

export function modelResourceSummaryFrom(
  record: ModelResourceRecord,
): ModelResourceSummary {
  return {
    id: record.id,
    key: record.key,
    displayName: record.displayName,
    ...(record.description ? { description: record.description } : {}),
    status: record.status,
    version: record.version,
    revisionId: record.revisionId,
    revision: record.revision,
    revisionDigest: record.revisionDigest,
    manifest: record.manifest,
    ...(record.manifest.nativeInterface
      ? {
          nativeInterfaceDigest: digestProviderValue(
            record.manifest.nativeInterface,
          ),
        }
      : {}),
    implementationCount: record.implementationCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function modelResourceMutationFrom(mutation: {
  readonly value: ModelResourceRecord;
  readonly replayed: boolean;
}): ModelResourceMutationResult {
  return {
    resource: modelResourceSummaryFrom(mutation.value),
    replayed: mutation.replayed,
  };
}

export function modelResourceImportSummaryFrom(
  record: ModelResourceImportRecord,
  maximumBytes: number,
): ModelResourceImportSummary {
  return {
    id: record.id,
    status: record.status,
    version: record.version,
    source: record.source,
    ...(record.catalogEntryId ? { catalogEntryId: record.catalogEntryId } : {}),
    ...(record.expectedByteSize
      ? { expectedByteSize: record.expectedByteSize }
      : {}),
    downloadedBytes: record.downloadedBytes,
    ...(record.cancelRequestedAt
      ? { cancelRequestedAt: record.cancelRequestedAt.toISOString() }
      : {}),
    ...(record.status === "waiting_upload"
      ? {
          upload: {
            maximumBytes: String(maximumBytes),
            expiresAt: record.uploadExpiresAt.toISOString(),
          },
        }
      : {}),
    ...(record.suggestedKey ? { suggestedKey: record.suggestedKey } : {}),
    ...(record.suggestedDisplayName
      ? { suggestedDisplayName: record.suggestedDisplayName }
      : {}),
    ...(record.format ? { format: record.format } : {}),
    files: record.files.map((file) => ({
      path: file.path,
      mediaType: file.mediaType,
      byteSize: file.byteSize,
      sha256: `sha256:${file.sha256}`,
    })),
    ...(record.license ? { license: record.license } : {}),
    ...(record.nativeInterface
      ? { nativeInterface: record.nativeInterface }
      : {}),
    compatibleAdapters: [...record.compatibleAdapters],
    requiredUserInputs: [
      ...record.requiredUserInputs,
    ] as ModelResourceImportSummary["requiredUserInputs"],
    ...(record.failure ? { failure: record.failure } : {}),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
