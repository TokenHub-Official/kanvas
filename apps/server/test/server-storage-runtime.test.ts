import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  RecordStorageCompatibilityProbeOptions,
  StorageUploadStore,
} from "@kanvas/database";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerConfig } from "../src/config.js";
import { createServerStorageRuntime } from "../src/storage/server-storage-runtime.js";

const profileId = "01K00000000000000000000001";
const workspaceId = "01K00000000000000000000002";
const probeId = "01K00000000000000000000003";
const configurationHash =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("server storage runtime", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it("validates the trusted root and records a bounded monthly capability probe", async () => {
    root = await realpath(
      await mkdtemp(join(tmpdir(), "kanvas-server-storage-")),
    );
    const recordCompatibilityProbe = vi.fn<
      StorageUploadStore["recordCompatibilityProbe"]
    >((options: RecordStorageCompatibilityProbeOptions) =>
      Promise.resolve({
        id: options.id,
        workspaceId: options.workspaceId,
        probeKey: options.probeKey,
        storageProfileId: options.storageProfileId,
        profileConfigurationHash: options.profileConfigurationHash,
        status: options.status,
        capabilities: options.capabilities,
        validUntil: options.validUntil,
        replayed: false,
      }),
    );
    const runtime = await createServerStorageRuntime({
      config: {
        kind: "local",
        profileId,
        rootDirectory: root,
        container: "objects",
        profileConfigurationHash: configurationHash,
        verificationProfileVersion: "trusted-image-structural-v1",
        verificationLeaseMilliseconds: 120_000,
        cleanupGraceMilliseconds: 3_600_000,
        userImportSessionTtlMilliseconds: 3_600_000,
        modelResourceImportSessionTtlMilliseconds: 3_600_000,
        modelResourceMaximumInputBytes: 536_870_912,
        verificationLimits: {
          maximumInputBytes: 134_217_728,
          maximumWidth: 32_768,
          maximumHeight: 32_768,
          maximumPixels: 134_217_728,
          maximumDecodedBytes: 536_870_912,
          maximumExpansionRatio: 2_048,
          requireDecodedVerification: false,
        },
      } satisfies NonNullable<ServerConfig["storage"]>,
      store: {
        recordCompatibilityProbe,
      } as unknown as StorageUploadStore,
      adapterVersion: "0.0.0-test",
    });

    await expect(
      runtime.ensureCompatibilityProbe(
        workspaceId,
        probeId,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      id: probeId,
      workspaceId,
      storageProfileId: profileId,
      status: "passed",
      validUntil: new Date("2026-08-01T00:00:00.000Z"),
    });

    const probe = recordCompatibilityProbe.mock.calls[0]?.[0];
    expect(probe).toMatchObject({
      probeKey: `storage-probe:v2:${probe?.requestHash}`,
      adapterKey: "local-filesystem.v1",
      adapterVersion: "0.0.0-test",
      profileConfigurationHash: configurationHash,
      status: "passed",
      capabilities: {
        supportsServerOwnedWrite: true,
        supportsRangeRead: true,
        supportsFullObjectChecksum: true,
        sealedIdentityImmutable: true,
      },
    });
    expect(probe?.requestHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(probe?.resultHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    await runtime.ensureCompatibilityProbe(
      workspaceId,
      probeId,
      new Date("2026-07-30T10:00:00.000Z"),
    );
    expect(recordCompatibilityProbe.mock.calls[1]?.[0].probeKey).toBe(
      probe?.probeKey,
    );
    await runtime.ensureCompatibilityProbe(
      workspaceId,
      probeId,
      new Date("2026-08-01T00:00:00.000Z"),
    );
    expect(recordCompatibilityProbe.mock.calls[2]?.[0].probeKey).not.toBe(
      probe?.probeKey,
    );
  });
});
