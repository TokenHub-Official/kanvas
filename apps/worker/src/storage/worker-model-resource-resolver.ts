import { createHash } from "node:crypto";

import type { ClaimedModelResource } from "@kanvas/database/runtime";
import type { ModelResourceManifest } from "@kanvas/contracts/api";
import type { TrustedImageStorageRuntime } from "@kanvas/storage";

export interface WorkerModelResourceAccess {
  readonly revisionId: string;
  readonly revisionDigest: string;
  readonly manifest: ModelResourceManifest;
  readonly read: (signal: AbortSignal) => Promise<Uint8Array>;
}

export interface WorkerModelResourceResolver {
  readonly bind: (resource: ClaimedModelResource) => WorkerModelResourceAccess;
}

function expectedByteSize(value: string, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new RangeError("Model resource exceeds the Worker byte limit.");
  }
  return parsed;
}

export function createWorkerModelResourceResolver(options: {
  readonly runtime: TrustedImageStorageRuntime;
}): WorkerModelResourceResolver {
  return Object.freeze({
    bind(resource: ClaimedModelResource) {
      const profile = options.runtime.profiles.resolve(
        resource.storage.storageProfileId,
      );
      if (
        !profile ||
        profile.adapter.storageProfileId !== resource.storage.storageProfileId
      ) {
        throw new Error("Model resource Storage profile is unavailable.");
      }
      const byteSize = expectedByteSize(
        resource.storage.byteSize,
        options.runtime.modelResourceMaximumInputBytes,
      );
      return Object.freeze({
        revisionId: resource.revisionId,
        revisionDigest: resource.revisionDigest,
        manifest: resource.manifest,
        async read(signal: AbortSignal) {
          signal.throwIfAborted();
          const opened = await profile.adapter.openRead({
            identity: {
              storageProfileId: resource.storage.storageProfileId,
              container: resource.storage.container,
              objectKey: resource.storage.objectKey,
              ...(resource.storage.storageVersionId
                ? { storageVersionId: resource.storage.storageVersionId }
                : {}),
            },
            expectedByteSize: resource.storage.byteSize,
            expectedSha256: resource.storage.sha256,
            expectedImmutableIdentityHash:
              resource.storage.immutableIdentityHash,
          });
          const chunks: Uint8Array[] = [];
          const hash = createHash("sha256");
          let received = 0;
          for await (const chunk of opened.body) {
            signal.throwIfAborted();
            received += chunk.byteLength;
            if (received > byteSize) {
              throw new Error("Model resource byte size is inconsistent.");
            }
            const copy = Uint8Array.from(chunk);
            chunks.push(copy);
            hash.update(copy);
          }
          signal.throwIfAborted();
          if (
            received !== byteSize ||
            hash.digest("hex") !== resource.storage.sha256
          ) {
            throw new Error("Model resource digest is inconsistent.");
          }
          const bytes = new Uint8Array(byteSize);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return bytes;
        },
      });
    },
  });
}
