import "reflect-metadata";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import {
  createLocalFilesystemStorageAdapter,
  createStorageProfileRegistry,
} from "@kanvas/storage";
import type {
  StorageObjectInspection,
  TrustedInstanceAdministratorScope,
} from "@kanvas/application";
import type { ServerDatabaseRuntime } from "../src/app.module.js";
import type { ServerStorageRuntime } from "../src/storage/server-storage-runtime.js";
import { SiteCoverService } from "../src/storage/site-cover.service.js";
it("uploads a real JPEG through shared object storage and reads back safe PNG bytes", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "site-cover-test-")),
  );
  const profile = "01K00000000000000000000001";
  const adapter = await createLocalFilesystemStorageAdapter({
    storageProfileId: profile,
    rootDirectory: root,
    acknowledgeTrustedProcessRoot: true,
  });
  try {
    const bytes = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: "#356ac1" },
    })
      .jpeg()
      .toBuffer();
    const record = {
      id: "01K00000000000000000000002",
      name: "cover.jpg",
      expectedSize: bytes.length,
      expectedMediaType: "image/jpeg",
      identity: {
        storageProfileId: profile,
        container: "test",
        objectKey: "sites/test/covers/cover.png",
      },
    };
    const session = {
      state: "allocated",
      record,
      expiresAt: new Date(Date.now() + 60000),
    };
    let inspection: StorageObjectInspection | undefined;
    let width = 0;
    let height = 0;
    const verified = vi.fn(
      async (
        _scope: unknown,
        _id: string,
        _token: string,
        object: StorageObjectInspection,
        w: number,
        h: number,
      ) => {
        inspection = object;
        width = w;
        height = h;
        await Promise.resolve();
      },
    );
    const release = vi.fn().mockResolvedValue(undefined);
    const write = vi.fn(adapter.writeObject);
    const cleanupJob = { id: record.id, token: "cleanup", record };
    const claimCleanup = vi
      .fn()
      .mockResolvedValueOnce(cleanupJob)
      .mockResolvedValue(null);
    const finishCleanup = vi.fn().mockResolvedValue(undefined);
    const database = {
      siteCovers: {
        get: vi.fn().mockResolvedValue(session),
        claim: vi.fn().mockResolvedValue({ session, token: "lease" }),
        verified,
        release,
        claimCleanup,
        finishCleanup,
      },
    } as unknown as ServerDatabaseRuntime;
    const storage = {
      profileId: profile,
      container: "test",
      profiles: createStorageProfileRegistry([
        {
          storageProfileId: profile,
          kind: adapter.kind,
          adapter: { ...adapter, writeObject: write },
        },
      ]),
    } as ServerStorageRuntime;
    const service = new SiteCoverService(database, storage);
    const scope = {} as TrustedInstanceAdministratorScope;
    expect(
      await service.upload(scope, record.id, Readable.from([bytes])),
    ).toEqual({ state: "verified" });
    expect(verified).toHaveBeenCalledOnce();
    expect(inspection).toBeDefined();
    const image = await service.materialize({
      id: record.id,
      bytes: Buffer.alloc(0),
      sha256: inspection!.sha256,
      width,
      height,
      storageObject: inspection!,
    });
    const metadata = await sharp(image.bytes).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(1600);
    expect(image.bytes.length).toBeLessThanOrEqual(512 * 1024);
    verified.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      service.upload(scope, record.id, Readable.from([bytes])),
    ).rejects.toThrow("database unavailable");
    expect(release).toHaveBeenCalledWith(scope, record.id, "lease");
    await expect(
      service.upload(scope, record.id, Readable.from([bytes])),
    ).resolves.toEqual({ state: "verified" });
    expect(write).toHaveBeenCalledOnce();
    await expect(
      service.upload(scope, record.id, Readable.from([bytes.subarray(0, 20)])),
    ).rejects.toThrow("size does not match");
    vi.useFakeTimers();
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() =>
      expect(finishCleanup).toHaveBeenCalledWith(record.id, "cleanup"),
    );
    expect(await adapter.inspectObject(record.identity)).toBeUndefined();
    service.onModuleDestroy();
    vi.useRealTimers();
  } finally {
    vi.useRealTimers();
    await adapter.close?.();
    await rm(root, { recursive: true, force: true });
  }
});
