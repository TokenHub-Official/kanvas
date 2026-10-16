import { createHash, randomBytes } from "node:crypto";

import type {
  StorageObjectIdentity,
  StorageProfileRegistry,
} from "@kanvas/application";
import type {
  ClaimedUploadCleanup,
  StorageUploadStore,
} from "@kanvas/database";

export type StorageGarbageCollectionErrorCode =
  | "storage_gc.invalid_configuration"
  | "storage_gc.claim_mismatch"
  | "storage_gc.profile_unavailable"
  | "storage_gc.profile_mismatch"
  | "storage_gc.exact_facts_missing"
  | "storage_gc.external_delete_failed";

export class StorageGarbageCollectionError extends Error {
  constructor(
    readonly code: StorageGarbageCollectionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StorageGarbageCollectionError";
  }
}

export interface StorageGarbageCollectionStore {
  readonly claimNextCleanup: StorageUploadStore["claimNextCleanup"];
  readonly finalizeCleanupSuccess: StorageUploadStore["finalizeCleanupSuccess"];
  readonly finalizeCleanupFailure: StorageUploadStore["finalizeCleanupFailure"];
}

export interface CreateStorageGarbageCollectionCoordinatorOptions {
  readonly store: StorageGarbageCollectionStore;
  readonly profiles: StorageProfileRegistry;
  readonly now?: () => Date;
  readonly claimLeaseMilliseconds: number;
  readonly baseRetryMilliseconds: number;
  readonly maximumRetryMilliseconds: number;
  readonly cleanupTokenHashFactory?: () => string;
}

export type StorageGarbageCollectionRunResult =
  | { readonly status: "idle" }
  | {
      readonly status: "completed";
      readonly uploadSessionId: string;
      readonly disposition: "deleted" | "missing";
    }
  | {
      readonly status: "retry_scheduled";
      readonly uploadSessionId: string;
      readonly errorCode: string;
      readonly retryAt: Date;
    };

export interface StorageGarbageCollectionCoordinator {
  runNext(): Promise<StorageGarbageCollectionRunResult>;
}

const tokenHashPattern = /^[0-9a-f]{64}$/u;

function fail(
  code: StorageGarbageCollectionErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new StorageGarbageCollectionError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function validDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function cleanupIdentity(claim: ClaimedUploadCleanup): StorageObjectIdentity {
  return Object.freeze({
    storageProfileId: claim.storageProfileId,
    container: claim.container,
    objectKey: claim.objectKey,
    ...(claim.storageVersionId
      ? { storageVersionId: claim.storageVersionId }
      : {}),
  });
}

function exactCleanupFacts(claim: ClaimedUploadCleanup):
  | {
      readonly byteSize: string;
      readonly sha256: string;
      readonly immutableIdentityHash: string;
    }
  | undefined {
  if (!claim.sealedIdentityHash) {
    return undefined;
  }
  if (claim.verifiedSize && claim.verifiedSha256) {
    return Object.freeze({
      byteSize: claim.verifiedSize,
      sha256: claim.verifiedSha256,
      immutableIdentityHash: claim.sealedIdentityHash,
    });
  }
  if (claim.expectedSize && claim.expectedSha256) {
    return Object.freeze({
      byteSize: claim.expectedSize,
      sha256: claim.expectedSha256,
      immutableIdentityHash: claim.sealedIdentityHash,
    });
  }
  return undefined;
}

function stableExternalErrorCode(error: unknown): string {
  if (
    error instanceof StorageGarbageCollectionError &&
    error.code !== "storage_gc.invalid_configuration"
  ) {
    return error.code;
  }
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    /^(?:local|s3)_storage\.[a-z0-9_]+$/u.test(error.code)
  ) {
    return error.code;
  }
  return "storage_gc.external_delete_failed";
}

function boundedRetryDelay(
  cleanupAttempt: number,
  base: number,
  maximum: number,
): number {
  const exponent = Math.min(Math.max(0, cleanupAttempt - 1), 30);
  return Math.min(maximum, base * 2 ** exponent);
}

export function createStorageGarbageCollectionCoordinator(
  options: CreateStorageGarbageCollectionCoordinatorOptions,
): StorageGarbageCollectionCoordinator {
  for (const value of [
    options.claimLeaseMilliseconds,
    options.baseRetryMilliseconds,
    options.maximumRetryMilliseconds,
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      return fail(
        "storage_gc.invalid_configuration",
        "Storage cleanup timing must use positive safe integers.",
      );
    }
  }
  if (options.maximumRetryMilliseconds < options.baseRetryMilliseconds) {
    return fail(
      "storage_gc.invalid_configuration",
      "Maximum cleanup retry delay cannot be below its base.",
    );
  }
  const clock = options.now ?? (() => new Date());
  const tokenFactory =
    options.cleanupTokenHashFactory ??
    (() => createHash("sha256").update(randomBytes(32)).digest("hex"));

  return Object.freeze({
    async runNext() {
      const claimNow = clock();
      if (!validDate(claimNow)) {
        return fail(
          "storage_gc.invalid_configuration",
          "Storage cleanup clock returned an invalid date.",
        );
      }
      const tokenHash = tokenFactory();
      if (!tokenHashPattern.test(tokenHash)) {
        return fail(
          "storage_gc.invalid_configuration",
          "Storage cleanup token factory returned an invalid hash.",
        );
      }
      const leaseExpiresAt = new Date(
        claimNow.getTime() + options.claimLeaseMilliseconds,
      );
      if (!validDate(leaseExpiresAt)) {
        return fail(
          "storage_gc.invalid_configuration",
          "Storage cleanup lease exceeds the date boundary.",
        );
      }
      const claim = await options.store.claimNextCleanup({
        cleanupTokenHash: tokenHash,
        now: claimNow,
        leaseExpiresAt,
      });
      if (!claim) {
        return Object.freeze({ status: "idle" });
      }
      if (
        claim.cleanupTokenHash !== tokenHash ||
        !Number.isSafeInteger(claim.cleanupAttempt) ||
        claim.cleanupAttempt < 1
      ) {
        return fail(
          "storage_gc.claim_mismatch",
          "Storage cleanup claim is not bound to this worker token.",
        );
      }

      let disposition: "deleted" | "missing";
      try {
        const profile = options.profiles.resolve(claim.storageProfileId);
        if (!profile) {
          return fail(
            "storage_gc.profile_unavailable",
            "Claimed cleanup storage profile is unavailable.",
          );
        }
        if (
          profile.adapter.storageProfileId !== claim.storageProfileId ||
          profile.adapter.kind !== profile.kind
        ) {
          return fail(
            "storage_gc.profile_mismatch",
            "Claimed cleanup storage profile does not match its adapter.",
          );
        }
        if (
          claim.uploadMode !== "server_stream" ||
          claim.storageVersionId !== undefined ||
          claim.providerUploadId !== undefined ||
          claim.providerEtag !== undefined
        ) {
          return fail(
            "storage_gc.profile_mismatch",
            "Claimed cleanup facts are incompatible with a server-owned Storage profile.",
          );
        }
        const identity = cleanupIdentity(claim);
        if (!claim.sealedIdentityHash) {
          const result =
            await profile.adapter.cleanupUnpublishedObject(identity);
          disposition = result.disposition;
        } else {
          const exact = exactCleanupFacts(claim);
          if (!exact) {
            return fail(
              "storage_gc.exact_facts_missing",
              "Sealed cleanup has no exact DB-backed size and digest pair.",
            );
          }
          const result = await profile.adapter.deleteObject({
            identity,
            expectedByteSize: exact.byteSize,
            expectedSha256: exact.sha256,
            expectedImmutableIdentityHash: exact.immutableIdentityHash,
          });
          disposition = result.disposition;
        }
      } catch (error) {
        const errorCode = stableExternalErrorCode(error);
        const failureNow = clock();
        if (!validDate(failureNow)) {
          throw error;
        }
        const retryAt = new Date(
          failureNow.getTime() +
            boundedRetryDelay(
              claim.cleanupAttempt,
              options.baseRetryMilliseconds,
              options.maximumRetryMilliseconds,
            ),
        );
        if (!validDate(retryAt)) {
          throw error;
        }
        await options.store.finalizeCleanupFailure({
          workspaceId: claim.workspaceId,
          uploadSessionId: claim.uploadSessionId,
          cleanupTokenHash: claim.cleanupTokenHash,
          errorCode,
          now: failureNow,
          retryAt,
        });
        return Object.freeze({
          status: "retry_scheduled",
          uploadSessionId: claim.uploadSessionId,
          errorCode,
          retryAt,
        });
      }

      /*
       * Deliberately outside the external-delete catch. If this CAS fails
       * after deletion, the claim is reaped later; exact deletion then
       * returns `missing` and safely converges.
       */
      const finalizeNow = clock();
      if (!validDate(finalizeNow)) {
        return fail(
          "storage_gc.invalid_configuration",
          "Storage cleanup clock returned an invalid finalize date.",
        );
      }
      await options.store.finalizeCleanupSuccess({
        workspaceId: claim.workspaceId,
        uploadSessionId: claim.uploadSessionId,
        cleanupTokenHash: claim.cleanupTokenHash,
        result: disposition,
        now: finalizeNow,
      });
      return Object.freeze({
        status: "completed",
        uploadSessionId: claim.uploadSessionId,
        disposition,
      });
    },
  });
}
