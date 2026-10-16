import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import type { ArtifactRepresentationStore } from "@kanvas/database/runtime";
import type {
  ArtifactPreviewConfig,
  TrustedImageStorageRuntime,
} from "@kanvas/storage";
import sharp from "sharp";

export interface ArtifactPreviewMaterializer {
  readonly materialize: (options: {
    readonly workspaceId: string;
    readonly artifactId: string;
  }) => Promise<
    | { readonly status: "created" | "existing" }
    | { readonly status: "skipped"; readonly reason: string }
  >;
}

export interface CreateArtifactPreviewMaterializerOptions {
  readonly config: ArtifactPreviewConfig;
  readonly runtime: TrustedImageStorageRuntime;
  readonly store: ArtifactRepresentationStore;
  readonly nextId: () => string;
}

const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;

function representationObjectKey(
  workspaceId: string,
  artifactId: string,
  profileVersion: string,
): string {
  const profileDigest = createHash("sha256")
    .update(profileVersion)
    .digest("hex");
  return `v1/w/${workspaceId}/artifact-representations/${artifactId}/${profileDigest}.webp`;
}

async function collect(
  body: AsyncIterable<Uint8Array>,
  maximumBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maximumBytes) {
      throw new RangeError("Artifact preview source exceeds its byte limit.");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

function sameObject(
  inspection: {
    readonly byteSize: string;
    readonly sha256: string;
  },
  buffer: Buffer,
): boolean {
  return (
    inspection.byteSize === String(buffer.byteLength) &&
    inspection.sha256 === createHash("sha256").update(buffer).digest("hex")
  );
}

export function createArtifactPreviewMaterializer(
  options: CreateArtifactPreviewMaterializerOptions,
): ArtifactPreviewMaterializer {
  let active = 0;
  const waiters: Array<() => void> = [];
  return Object.freeze({
    async materialize(
      request: Parameters<ArtifactPreviewMaterializer["materialize"]>[0],
    ) {
      if (active >= options.config.workerConcurrency) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      active += 1;
      try {
        if (options.config.mode !== "async_persisted") {
          return {
            status: "skipped" as const,
            reason: "preview_mode_on_demand",
          };
        }
        const existing = await options.store.findAvailable({
          workspaceId: request.workspaceId,
          sourceArtifactId: request.artifactId,
          variantKey: options.config.variantKey,
          profileVersion: options.config.profileVersion,
        });
        if (existing) return { status: "existing" as const };

        const source = await options.store.readSource(request);
        if (!source) {
          return { status: "skipped" as const, reason: "source_unavailable" };
        }
        if (
          !uint64Pattern.test(source.byteSize) ||
          BigInt(source.byteSize) > BigInt(options.config.maximumSourceBytes)
        ) {
          return { status: "skipped" as const, reason: "source_too_large" };
        }
        const sourceProfile = options.runtime.profiles.resolve(
          source.storageProfileId,
        );
        const destinationProfile = options.runtime.profiles.resolve(
          options.runtime.profileId,
        );
        if (!sourceProfile || !destinationProfile) {
          throw new Error("Artifact preview Storage profile is unavailable.");
        }
        const sourceRead = await sourceProfile.adapter.openRead({
          identity: {
            storageProfileId: source.storageProfileId,
            container: source.container,
            objectKey: source.objectKey,
          },
          expectedByteSize: source.byteSize,
          expectedSha256: source.sha256,
          expectedImmutableIdentityHash: source.immutableIdentityHash,
        });
        const sourceBytes = await collect(
          sourceRead.body,
          options.config.maximumSourceBytes,
        );
        const generated = await sharp(sourceBytes, {
          animated: false,
          limitInputPixels: 100_000_000,
        })
          .rotate()
          .resize({
            width: options.config.width,
            height: options.config.height,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({
            quality: options.config.quality,
            effort: options.config.effort,
          })
          .toBuffer({ resolveWithObject: true });
        const identity = {
          storageProfileId: options.runtime.profileId,
          container: options.runtime.container,
          objectKey: representationObjectKey(
            request.workspaceId,
            request.artifactId,
            options.config.profileVersion,
          ),
        };
        let inspection =
          await destinationProfile.adapter.inspectObject(identity);
        if (!inspection) {
          inspection = await destinationProfile.adapter.writeObject({
            identity,
            maximumBytes: String(generated.data.byteLength),
            body: Readable.from([generated.data]),
          });
        }
        if (!sameObject(inspection, generated.data)) {
          throw new Error(
            "Artifact preview object identity conflicts with generated bytes.",
          );
        }
        const sealed = await destinationProfile.adapter.sealObject({
          identity,
          expectedByteSize: inspection.byteSize,
          expectedSha256: inspection.sha256,
        });
        await options.store.commit({
          id: options.nextId(),
          workspaceId: request.workspaceId,
          sourceArtifactId: request.artifactId,
          variantKey: options.config.variantKey,
          profileVersion: options.config.profileVersion,
          storageProfileId: sealed.identity.storageProfileId,
          container: sealed.identity.container,
          objectKey: sealed.identity.objectKey,
          immutableIdentityHash: sealed.immutableIdentityHash,
          byteSize: sealed.byteSize,
          sha256: sealed.sha256,
          mediaType: "image/webp",
          width: generated.info.width,
          height: generated.info.height,
          now: new Date(),
        });
        return { status: "created" as const };
      } finally {
        active -= 1;
        waiters.shift()?.();
      }
    },
  });
}
