import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DecodeVerifier, StoragePort } from "@kanvas/application";
import type { UploadSessionRecord, UploadSessionState } from "@kanvas/database";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalFilesystemStorageAdapter } from "../src/local-filesystem-adapter.js";
import {
  createServerStreamUploadCoordinator,
  type ServerStreamUploadStore,
} from "../src/server-stream-upload-coordinator.js";
import { createStorageProfileRegistry } from "../src/storage-profile-registry.js";

const ids = {
  workspace: "01K00000000000000000000001",
  actor: "01K00000000000000000000002",
  session: "01K00000000000000000000003",
  profile: "01K00000000000000000000004",
  probe: "01K00000000000000000000005",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function png(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", Buffer.from([0x78, 0x01])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function* bytes(value: Uint8Array): AsyncGenerator<Uint8Array> {
  await Promise.resolve();
  yield value;
}

function session(state: UploadSessionState = "open"): UploadSessionRecord {
  return Object.freeze({
    id: ids.session,
    workspaceId: ids.workspace,
    actorId: ids.actor,
    purpose: "user_import",
    expectedMediaType: "image/png",
    storageProfileId: ids.profile,
    compatibilityProbeId: ids.probe,
    profileConfigurationHash: `sha256:${"a".repeat(64)}`,
    container: "objects",
    objectKey: `v1/w/${ids.workspace}/u/${ids.session}/o/object`,
    uploadMode: "server_stream",
    writeProtectionMode: "server_owned",
    state,
    version: 1,
    expiresAt: new Date(now.getTime() + 60_000),
    cleanupEligibleAt: new Date(now.getTime() + 120_000),
    verificationProfileVersion: "trusted-image-v1",
    replayed: false,
  });
}

function storeHarness(expectedMediaType = "image/png"): {
  readonly store: ServerStreamUploadStore;
  readonly recordVerified: ReturnType<typeof vi.fn>;
  readonly recordRejected: ReturnType<typeof vi.fn>;
} {
  let state: UploadSessionState = "open";
  let sealedIdentityHash = "";
  const recordVerified = vi.fn<ServerStreamUploadStore["recordVerified"]>(
    () => {
      state = "verified";
      return Promise.resolve({
        uploadSessionId: ids.session,
        state,
        version: 6,
        changed: true,
      });
    },
  );
  const recordRejected = vi.fn<ServerStreamUploadStore["recordRejected"]>(
    () => {
      state = "rejected";
      return Promise.resolve({
        uploadSessionId: ids.session,
        state,
        version: 6,
        changed: true,
      });
    },
  );
  return {
    store: {
      beginUpload: vi.fn<ServerStreamUploadStore["beginUpload"]>(() =>
        Promise.resolve({
          uploadSessionId: ids.session,
          state,
          version: 2,
          changed: true,
        }),
      ),
      beginSeal: vi.fn<ServerStreamUploadStore["beginSeal"]>(() => {
        state = "sealing";
        return Promise.resolve({
          uploadSessionId: ids.session,
          state,
          version: 3,
          changed: true,
        });
      }),
      recordSeal: vi.fn<ServerStreamUploadStore["recordSeal"]>((options) => {
        sealedIdentityHash = options.sealedIdentityHash;
        state = "verifying";
        return Promise.resolve({
          uploadSessionId: ids.session,
          state,
          version: 4,
          changed: true,
        });
      }),
      claimVerification: vi.fn<ServerStreamUploadStore["claimVerification"]>(
        (options) =>
          Promise.resolve({
            uploadSessionId: ids.session,
            workspaceId: ids.workspace,
            processingLeaseGeneration: 1,
            processingLeaseTokenHash: options.processingLeaseTokenHash,
            processingLeaseExpiresAt: options.leaseExpiresAt,
            storageProfileId: ids.profile,
            container: "objects",
            objectKey: `v1/w/${ids.workspace}/u/${ids.session}/o/object`,
            sealedIdentityHash,
            expectedMediaType,
            verificationProfileVersion: "trusted-image-v1",
          }),
      ),
      recordVerified,
      recordRejected,
    },
    recordVerified,
    recordRejected,
  };
}

const decodeVerifier: DecodeVerifier = {
  verifyDecodedImage: vi.fn<DecodeVerifier["verifyDecodedImage"]>((request) =>
    Promise.resolve({
      width: request.structuralWidth,
      height: request.structuralHeight,
      frameCount: 1,
    }),
  ),
};

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(
  expectedMediaType = "image/png",
  kind: StoragePort["kind"] = "local",
  maximumInputBytes = 1_000_000,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kanvas-upload-")));
  roots.push(root);
  const localAdapter = await createLocalFilesystemStorageAdapter({
    storageProfileId: ids.profile,
    rootDirectory: root,
    acknowledgeTrustedProcessRoot: true,
  });
  const openRead = vi.fn<StoragePort["openRead"]>((request) =>
    localAdapter.openRead(request),
  );
  const adapter: StoragePort =
    kind === "local"
      ? Object.freeze({ ...localAdapter, openRead })
      : Object.freeze({
          ...localAdapter,
          openRead,
          kind: "s3" as const,
          capabilities: Object.freeze({
            ...localAdapter.capabilities,
            deploymentScope: "distributed" as const,
          }),
        });
  const profiles = createStorageProfileRegistry([
    {
      storageProfileId: ids.profile,
      kind,
      adapter,
    },
  ]);
  const harness = storeHarness(expectedMediaType);
  const coordinator = createServerStreamUploadCoordinator({
    store: harness.store,
    profiles,
    verificationLimits: {
      maximumInputBytes,
      maximumWidth: 10_000,
      maximumHeight: 10_000,
      maximumPixels: 20_000_000,
      maximumDecodedBytes: 100_000_000,
      maximumExpansionRatio: 1_000,
      requireDecodedVerification: true,
    },
    verificationLeaseMilliseconds: 30_000,
    decodeVerifier,
    now: () => now,
    createLeaseToken: () => Buffer.alloc(32, 7),
  });
  return { adapter, coordinator, harness, openRead };
}

describe("ServerStreamUploadCoordinator", () => {
  it("recovers an acknowledged-lost write without writing or consuming a body", async () => {
    const { adapter, coordinator, harness } = await fixture();
    const upload = session();
    await adapter.writeObject({
      identity: {
        storageProfileId: upload.storageProfileId,
        container: upload.container,
        objectKey: upload.objectKey,
      },
      maximumBytes: "1024",
      body: bytes(png()),
    });
    const body = (async function* () {
      await Promise.resolve();
      throw new Error("Recovery must not consume a body");
      yield new Uint8Array();
    })();
    await expect(
      coordinator.ingest({
        session: upload,
        body,
        recoverStoredObjectOnly: true,
      }),
    ).resolves.toMatchObject({ state: "verified" });
    expect(harness.recordVerified).toHaveBeenCalledOnce();
  });

  it("does not create an empty object when a previous write is missing", async () => {
    const { adapter, coordinator } = await fixture();
    await expect(
      coordinator.ingest({
        session: session(),
        body: bytes(png()),
        recoverStoredObjectOnly: true,
      }),
    ).rejects.toMatchObject({
      code: "server_stream_upload.object_unavailable",
    });
    const upload = session();
    await expect(
      adapter.inspectObject({
        storageProfileId: upload.storageProfileId,
        container: upload.container,
        objectKey: upload.objectKey,
      }),
    ).resolves.toBeUndefined();
  });
  it.each(["local", "s3"] as const)(
    "writes, seals, decodes, and records a trusted image through %s storage",
    async (kind) => {
      const { adapter, coordinator, harness, openRead } = await fixture(
        "image/png",
        kind,
      );

      await expect(
        coordinator.ingest({
          session: session(),
          body: bytes(png()),
        }),
      ).resolves.toEqual({
        uploadSessionId: ids.session,
        state: "verified",
        replayed: false,
      });

      expect(harness.recordVerified).toHaveBeenCalledOnce();
      expect(harness.recordRejected).not.toHaveBeenCalled();
      expect(openRead).not.toHaveBeenCalled();
      await expect(
        adapter.inspectObject({
          storageProfileId: ids.profile,
          container: "objects",
          objectKey: `v1/w/${ids.workspace}/u/${ids.session}/o/object`,
        }),
      ).resolves.toMatchObject({
        byteSize: String(png().byteLength),
      });
    },
  );

  it("records a stable rejection for malformed media", async () => {
    const { coordinator, harness } = await fixture();

    await expect(
      coordinator.ingest({
        session: session(),
        body: bytes(Buffer.from("not-an-image")),
      }),
    ).rejects.toMatchObject({
      code: "server_stream_upload.verification_rejected",
    });
    expect(harness.recordRejected).toHaveBeenCalledOnce();
    expect(harness.recordVerified).not.toHaveBeenCalled();
  });

  it("reads the sealed object when an allocation is too large to capture safely", async () => {
    const { coordinator, openRead } = await fixture(
      "image/png",
      "s3",
      20_000_000,
    );

    await expect(
      coordinator.ingest({
        session: session(),
        body: bytes(png()),
      }),
    ).resolves.toMatchObject({ state: "verified" });

    expect(openRead).toHaveBeenCalledOnce();
  });

  it("records an unsupported allocated media type as a terminal rejection", async () => {
    const { coordinator, harness } = await fixture("image/svg+xml");

    await expect(
      coordinator.ingest({
        session: {
          ...session(),
          expectedMediaType: "image/svg+xml",
        },
        body: bytes(png()),
      }),
    ).rejects.toMatchObject({
      code: "server_stream_upload.verification_rejected",
    });
    expect(harness.recordRejected).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "media_verification.unsupported_media",
      }),
    );
    expect(harness.recordVerified).not.toHaveBeenCalled();
  });

  it("returns terminal allocation replays without touching storage", async () => {
    const { coordinator, harness } = await fixture();
    let bodyConsumed = false;

    await expect(
      coordinator.ingest({
        session: session("verified"),
        body: (async function* replayBody() {
          await Promise.resolve();
          yield Buffer.from("unused");
          bodyConsumed = true;
        })(),
      }),
    ).resolves.toEqual({
      uploadSessionId: ids.session,
      state: "verified",
      replayed: true,
    });
    expect(bodyConsumed).toBe(true);
    expect(harness.store.beginUpload).not.toHaveBeenCalled();
    expect(harness.store.claimVerification).not.toHaveBeenCalled();
  });

  it("bounds a terminal replay body before returning success", async () => {
    const { coordinator, harness } = await fixture();

    await expect(
      coordinator.ingest({
        session: {
          ...session("verified"),
          expectedSize: "3",
        },
        body: bytes(Buffer.from("four")),
      }),
    ).rejects.toMatchObject({
      code: "server_stream_upload.verification_rejected",
    });
    expect(harness.store.beginUpload).not.toHaveBeenCalled();
    expect(harness.store.claimVerification).not.toHaveBeenCalled();
  });
});
