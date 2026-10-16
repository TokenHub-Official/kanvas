import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorageUploadStore } from "@kanvas/database/runtime";
import { expect, it, vi } from "vitest";
import { createTrustedImageStorageRuntime } from "../src/trusted-image-storage-runtime.js";
import { loadTrustedImageStorageConfig } from "../src/trusted-image-storage-config.js";

it("keeps probe replays stable but gives an upgrade its own immutable probe identity", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "kanvas-probe-upgrade-")),
  );
  const record = vi.fn((request: unknown) => Promise.resolve(request));
  const store = {
    recordCompatibilityProbe: record,
  } as unknown as StorageUploadStore;
  const config = loadTrustedImageStorageConfig(
    {
      KANVAS_STORAGE_KIND: "local",
      KANVAS_LOCAL_STORAGE_ROOT: root,
      KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000020",
      KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK:
        "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT",
    },
    "test",
  )!;
  const runtimes = [];
  try {
    for (const version of ["old-release", "new-release"]) {
      const runtime = await createTrustedImageStorageRuntime({
        config,
        store,
        adapterVersion: version,
      });
      runtimes.push(runtime);
      await runtime.ensureCompatibilityProbe(
        "01K00000000000000000000001",
        "01K00000000000000000000002",
        new Date("2026-09-20T00:00:00Z"),
      );
      await runtime.ensureCompatibilityProbe(
        "01K00000000000000000000001",
        "01K00000000000000000000003",
        new Date("2026-09-21T00:00:00Z"),
      );
    }
    const requests = record.mock.calls.map(
      ([request]) => request as { probeKey: string; requestHash: string },
    );
    expect(requests[0]?.probeKey).toBe(requests[1]?.probeKey);
    expect(requests[2]?.probeKey).toBe(requests[3]?.probeKey);
    expect(requests[0]?.requestHash).not.toBe(requests[2]?.requestHash);
    expect(requests[0]?.probeKey).not.toBe(requests[2]?.probeKey);
  } finally {
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    await rm(root, { recursive: true, force: true });
  }
});
