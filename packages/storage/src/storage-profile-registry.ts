import type {
  RegisteredStorageProfile,
  StorageProfileRegistry,
} from "@kanvas/application";

export type StorageProfileRegistryErrorCode =
  "storage_profile.invalid" | "storage_profile.duplicate";

export class StorageProfileRegistryError extends Error {
  constructor(
    readonly code: StorageProfileRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StorageProfileRegistryError";
  }
}

export function createStorageProfileRegistry(
  profiles: readonly RegisteredStorageProfile[],
): StorageProfileRegistry {
  const byId = new Map<string, RegisteredStorageProfile>();
  for (const profile of profiles) {
    if (
      profile.storageProfileId.length === 0 ||
      profile.storageProfileId !== profile.adapter.storageProfileId ||
      profile.kind !== profile.adapter.kind
    ) {
      throw new StorageProfileRegistryError(
        "storage_profile.invalid",
        "Storage profile metadata does not match its adapter.",
      );
    }
    if (byId.has(profile.storageProfileId)) {
      throw new StorageProfileRegistryError(
        "storage_profile.duplicate",
        "Storage profile identity must be unique.",
      );
    }
    byId.set(profile.storageProfileId, Object.freeze({ ...profile }));
  }
  return Object.freeze({
    resolve(storageProfileId: string) {
      return byId.get(storageProfileId);
    },
  });
}
