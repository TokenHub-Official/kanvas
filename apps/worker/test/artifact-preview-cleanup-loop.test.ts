import type { ArtifactRepresentationStore } from "@kanvas/database/runtime";
import type { TrustedImageStorageRuntime } from "@kanvas/storage";
import { describe, expect, it, vi } from "vitest";

import { ArtifactPreviewCleanupLoop } from "../src/storage/artifact-preview-cleanup-loop.js";

describe("ArtifactPreviewCleanupLoop", () => {
  it("deletes a claimed representation by exact immutable identity", async () => {
    const finalizeCleanupSuccess = vi
      .fn<ArtifactRepresentationStore["finalizeCleanupSuccess"]>()
      .mockResolvedValue(undefined);
    const deleteObject = vi.fn().mockResolvedValue({ disposition: "deleted" });
    const store = {
      claimNextCleanup: vi.fn().mockResolvedValue({
        id: "01K00000000000000000000001",
        workspaceId: "01K00000000000000000000002",
        sourceArtifactId: "01K00000000000000000000003",
        variantKey: "interactive-preview",
        profileVersion: `artifact-preview-webp-v1:${"a".repeat(64)}`,
        storageProfileId: "01K00000000000000000000004",
        container: "objects",
        objectKey: "preview.webp",
        immutableIdentityHash: `sha256:${"b".repeat(64)}`,
        byteSize: "4",
        sha256: "b".repeat(64),
        mediaType: "image/webp",
        width: 1,
        height: 1,
        state: "deletion_pending",
        createdAt: new Date("2026-08-18T12:00:00.000Z"),
        cleanupTokenHash: "c".repeat(64),
        cleanupAttempt: 1,
      }),
      finalizeCleanupSuccess,
    } as unknown as ArtifactRepresentationStore;
    const runtime = {
      profiles: {
        resolve: () => ({ adapter: { deleteObject } }),
      },
    } as unknown as TrustedImageStorageRuntime;
    const loop = new ArtifactPreviewCleanupLoop({
      runtime,
      store,
      logger: { error: vi.fn() },
      pollIntervalMs: 30_000,
      retryMs: 30_000,
    });

    await loop.runOnce();

    expect(deleteObject).toHaveBeenCalledWith({
      identity: {
        storageProfileId: "01K00000000000000000000004",
        container: "objects",
        objectKey: "preview.webp",
      },
      expectedByteSize: "4",
      expectedSha256: "b".repeat(64),
      expectedImmutableIdentityHash: `sha256:${"b".repeat(64)}`,
    });
    expect(finalizeCleanupSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ result: "deleted" }),
    );
  });
});
