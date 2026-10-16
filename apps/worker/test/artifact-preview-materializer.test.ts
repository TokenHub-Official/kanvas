import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import type { StoragePort } from "@kanvas/application";
import type { ArtifactRepresentationStore } from "@kanvas/database/runtime";
import {
  loadArtifactPreviewConfig,
  type TrustedImageStorageRuntime,
} from "@kanvas/storage";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { createArtifactPreviewMaterializer } from "../src/storage/artifact-preview-materializer.js";

const ids = {
  workspace: "01K00000000000000000000001",
  artifact: "01K00000000000000000000002",
  profile: "01K00000000000000000000003",
  representation: "01K00000000000000000000004",
} as const;

describe("Artifact preview materializer", () => {
  it("generates and idempotently commits a bounded WebP representation", async () => {
    const source = await sharp({
      create: {
        width: 1_200,
        height: 800,
        channels: 4,
        background: "#3048f5",
      },
    })
      .png()
      .toBuffer();
    const sourceSha = createHash("sha256").update(source).digest("hex");
    let written: Buffer | undefined;
    const openRead = vi.fn<StoragePort["openRead"]>(() =>
      Promise.resolve({
        identity: {
          storageProfileId: ids.profile,
          container: "objects",
          objectKey: "source.png",
        },
        totalByteSize: String(source.byteLength),
        contentByteSize: String(source.byteLength),
        body: Readable.from([source]),
      }),
    );
    const inspectObject = vi
      .fn<StoragePort["inspectObject"]>()
      .mockResolvedValue(undefined);
    const writeObject = vi.fn<StoragePort["writeObject"]>(async (request) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request.body) chunks.push(Buffer.from(chunk));
      written = Buffer.concat(chunks);
      const sha256 = createHash("sha256").update(written).digest("hex");
      return {
        identity: request.identity,
        byteSize: String(written.byteLength),
        sha256,
        immutableIdentityHash: `sha256:${sha256}`,
        writeProtectionMode: "server_owned" as const,
      };
    });
    const sealObject = vi.fn<StoragePort["sealObject"]>((request) =>
      Promise.resolve({
        identity: request.identity,
        byteSize: request.expectedByteSize,
        sha256: request.expectedSha256,
        immutableIdentityHash: `sha256:${request.expectedSha256}`,
      }),
    );
    const adapter: StoragePort = {
      kind: "local" as const,
      storageProfileId: ids.profile,
      capabilities: {
        uploadModes: ["server_stream"] as const,
        writeProtectionModes: ["server_owned"] as const,
        multipart: false as const,
        fullObjectChecksum: true,
        rangeRead: true,
        versionBoundIdentity: false,
        sealedIdentityImmutable: true,
        deploymentScope: "single_node" as const,
        maximumObjectBytes: "100000000",
        serverSideEncryption: "not_provided" as const,
      },
      openRead,
      inspectObject,
      writeObject,
      sealObject,
      deleteObject: () => Promise.resolve({ disposition: "deleted" }),
      cleanupUnpublishedObject: () =>
        Promise.resolve({ disposition: "deleted" }),
    };
    const commit = vi.fn<ArtifactRepresentationStore["commit"]>((options) =>
      Promise.resolve({
        ...options,
        state: "available",
        createdAt: options.now,
      }),
    );
    const store = {
      findAvailable: vi.fn(() => Promise.resolve(undefined)),
      readSource: vi.fn(() =>
        Promise.resolve({
          workspaceId: ids.workspace,
          artifactId: ids.artifact,
          storageProfileId: ids.profile,
          container: "objects",
          objectKey: "source.png",
          immutableIdentityHash: `sha256:${sourceSha}`,
          byteSize: String(source.byteLength),
          sha256: sourceSha,
          mediaType: "image/png" as const,
        }),
      ),
      commit,
    } as unknown as ArtifactRepresentationStore;
    const runtime = {
      profileId: ids.profile,
      container: "objects",
      profiles: {
        resolve: () => ({
          storageProfileId: ids.profile,
          kind: "local" as const,
          adapter,
        }),
      },
    } as unknown as TrustedImageStorageRuntime;
    const materializer = createArtifactPreviewMaterializer({
      config: loadArtifactPreviewConfig({
        KANVAS_ARTIFACT_PREVIEW_MODE: "async_persisted",
      }),
      runtime,
      store,
      nextId: () => ids.representation,
    });

    await expect(
      materializer.materialize({
        workspaceId: ids.workspace,
        artifactId: ids.artifact,
      }),
    ).resolves.toEqual({ status: "created" });

    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ids.representation,
        sourceArtifactId: ids.artifact,
        mediaType: "image/webp",
        width: 640,
        height: 427,
      }),
    );
    expect(written).toBeDefined();
    if (!written) throw new Error("Preview bytes were not written.");
    await expect(sharp(written).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 640,
      height: 427,
    });
  });
});
