import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  StorageObjectIdentity,
  StorageWriteResult,
} from "@kanvas/application";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalFilesystemStorageAdapter,
  LocalFilesystemStorageError,
  LocalStorageSimulatedCrashError,
  type LocalStorageCrashCheckpoint,
} from "../src/local-filesystem-adapter.js";

const profileId = "01K00000000000000000000001";
const otherProfileId = "01K00000000000000000000002";
const identity: StorageObjectIdentity = Object.freeze({
  storageProfileId: profileId,
  container: "artifacts",
  objectKey: "v1/workspace/output.bin",
});
const roots: string[] = [];

async function temporaryRoot(label: string): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), `kanvas-${label}-`));
  const root = await realpath(created);
  roots.push(root);
  return root;
}

function chunks(...values: readonly string[]): AsyncIterable<Uint8Array> {
  const encoded = values.map((value) => Buffer.from(value));
  const iterator = encoded[Symbol.iterator]();
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return Promise.resolve(iterator.next());
        },
      };
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactDelete(result: StorageWriteResult) {
  return Object.freeze({
    identity: result.identity,
    expectedByteSize: result.byteSize,
    expectedSha256: result.sha256,
    expectedImmutableIdentityHash: result.immutableIdentityHash,
  });
}

async function createAdapter(
  rootDirectory: string,
  crashCheckpoint?: (
    checkpoint: LocalStorageCrashCheckpoint,
  ) => void | Promise<void>,
) {
  return createLocalFilesystemStorageAdapter({
    storageProfileId: profileId,
    rootDirectory,
    acknowledgeTrustedProcessRoot: true,
    ...(crashCheckpoint ? { crashCheckpoint } : {}),
  });
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

describe("Local Filesystem storage adapter", () => {
  it("writes exclusively, seals, verifies exact reads, ranges, and idempotent deletion", async () => {
    const root = await temporaryRoot("lifecycle");
    const adapter = await createAdapter(root);
    const written = await adapter.writeObject({
      identity,
      maximumBytes: "64",
      body: chunks("hello", " world"),
    });

    expect(written).toMatchObject({
      byteSize: "11",
      sha256: sha256("hello world"),
      writeProtectionMode: "server_owned",
    });
    await expect(
      adapter.sealObject({
        identity,
        expectedByteSize: written.byteSize,
        expectedSha256: written.sha256,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        immutableIdentityHash: written.immutableIdentityHash,
      }),
    );

    const range = await adapter.openRead({
      identity,
      expectedByteSize: written.byteSize,
      expectedSha256: written.sha256,
      expectedImmutableIdentityHash: written.immutableIdentityHash,
      range: { start: "6", endInclusive: "10" },
    });
    const rangeBytes: Uint8Array[] = [];
    for await (const chunk of range.body) {
      rangeBytes.push(chunk);
    }
    expect(Buffer.concat(rangeBytes).toString()).toBe("world");
    expect(range).toMatchObject({
      totalByteSize: "11",
      contentByteSize: "5",
      range: { start: "6", endInclusive: "10" },
    });

    await expect(adapter.deleteObject(exactDelete(written))).resolves.toEqual({
      disposition: "deleted",
    });
    await expect(adapter.deleteObject(exactDelete(written))).resolves.toEqual({
      disposition: "missing",
    });
  });

  it("rejects non-canonical identities and every path control character", async () => {
    const root = await temporaryRoot("identity");
    const adapter = await createAdapter(root);
    for (const objectKey of [
      "../escape",
      "/absolute",
      "nested//empty",
      "line\nfeed",
      "horizontal\ttab",
      "delete\u007fcontrol",
      "windows\\separator",
    ]) {
      await expect(
        adapter.inspectObject({ ...identity, objectKey }),
      ).rejects.toMatchObject({
        code: "local_storage.invalid_identity",
      });
    }
    await expect(
      adapter.inspectObject({
        ...identity,
        storageProfileId: otherProfileId,
      }),
    ).rejects.toMatchObject({
      code: "local_storage.invalid_identity",
    });
    await expect(
      adapter.inspectObject({
        ...identity,
        storageVersionId: "provider-version",
      }),
    ).rejects.toMatchObject({
      code: "local_storage.invalid_identity",
    });
    await expect(
      createLocalFilesystemStorageAdapter({
        storageProfileId: "81K00000000000000000000001",
        rootDirectory: root,
        acknowledgeTrustedProcessRoot: true,
      }),
    ).rejects.toMatchObject({
      code: "local_storage.invalid_configuration",
    });
  });

  it("never overwrites a published key and detects same-size tampering before read or delete", async () => {
    const root = await temporaryRoot("tamper");
    const adapter = await createAdapter(root);
    const first = await adapter.writeObject({
      identity,
      maximumBytes: "16",
      body: chunks("first"),
    });
    await expect(
      adapter.writeObject({
        identity,
        maximumBytes: "16",
        body: chunks("other"),
      }),
    ).rejects.toMatchObject({
      code: "local_storage.object_exists",
    });
    const objectPath = join(root, identity.container, identity.objectKey);
    expect(await readFile(objectPath, "utf8")).toBe("first");

    await writeFile(objectPath, "other", { mode: 0o600 });
    const exact = exactDelete(first);
    await expect(
      adapter.openRead({
        identity,
        expectedByteSize: exact.expectedByteSize,
        expectedSha256: exact.expectedSha256,
        expectedImmutableIdentityHash: exact.expectedImmutableIdentityHash,
      }),
    ).rejects.toMatchObject({
      code: "local_storage.identity_mismatch",
    });
    await expect(adapter.deleteObject(exact)).rejects.toMatchObject({
      code: "local_storage.identity_mismatch",
    });
    expect(await readFile(objectPath, "utf8")).toBe("other");
    await chmod(objectPath, 0o666);
    await expect(adapter.inspectObject(identity)).rejects.toMatchObject({
      code: "local_storage.path_unsafe",
    });
  });

  it("fails closed on a parent symlink swap at the publication boundary", async () => {
    const root = await temporaryRoot("swap-root");
    const outside = await temporaryRoot("swap-outside");
    let swapped = false;
    const adapter = await createAdapter(root, async (checkpoint) => {
      if (checkpoint !== "after_temp_fsync" || swapped) {
        return;
      }
      swapped = true;
      const parent = join(root, "artifacts", "v1", "workspace");
      await rename(parent, `${parent}-trusted`);
      await symlink(outside, parent);
    });

    await expect(
      adapter.writeObject({
        identity,
        maximumBytes: "16",
        body: chunks("safe"),
      }),
    ).rejects.toMatchObject({
      code: "local_storage.path_unsafe",
    });
    await expect(lstat(join(outside, "output.bin"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("requires an owner-only canonical root and fails closed above Number.MAX_SAFE_INTEGER", async () => {
    const root = await temporaryRoot("permissions");
    await chmod(root, 0o770);
    await expect(createAdapter(root)).rejects.toMatchObject({
      code: "local_storage.invalid_configuration",
    });
    await chmod(root, 0o700);
    const adapter = await createAdapter(root);
    await expect(
      adapter.writeObject({
        identity,
        maximumBytes: "9007199254740992",
        body: chunks(),
      }),
    ).rejects.toMatchObject({
      code: "local_storage.size_limit_exceeded",
    });
  });

  it("leaves recoverable artifacts at each crash checkpoint without unsafe cleanup", async () => {
    const rootBeforePublish = await temporaryRoot("crash-temp");
    const tempCrash = await createAdapter(rootBeforePublish, (checkpoint) => {
      if (checkpoint === "after_temp_fsync") {
        throw new Error("crash");
      }
    });
    await expect(
      tempCrash.writeObject({
        identity,
        maximumBytes: "16",
        body: chunks("temp"),
      }),
    ).rejects.toBeInstanceOf(LocalStorageSimulatedCrashError);
    const tempParent = join(rootBeforePublish, "artifacts", "v1", "workspace");
    expect(
      (await readdir(tempParent)).some((entry) =>
        entry.startsWith(".output.bin.part."),
      ),
    ).toBe(true);
    const recoveredTemp = await createAdapter(rootBeforePublish);
    await expect(
      recoveredTemp.cleanupUnpublishedObject(identity),
    ).resolves.toEqual({ disposition: "deleted" });

    const rootAfterPublish = await temporaryRoot("crash-publish");
    const publishCrash = await createAdapter(rootAfterPublish, (checkpoint) => {
      if (checkpoint === "after_exclusive_publish") {
        throw new Error("crash");
      }
    });
    await expect(
      publishCrash.writeObject({
        identity,
        maximumBytes: "16",
        body: chunks("final"),
      }),
    ).rejects.toBeInstanceOf(LocalStorageSimulatedCrashError);
    const recoveredPublish = await createAdapter(rootAfterPublish);
    await expect(
      recoveredPublish.cleanupUnpublishedObject(identity),
    ).rejects.toMatchObject({
      code: "local_storage.identity_mismatch",
    });
    const inspected = await recoveredPublish.inspectObject(identity);
    expect(inspected).toBeDefined();
    if (!inspected) {
      throw new Error("Expected published crash artifact.");
    }
    await expect(
      recoveredPublish.deleteObject({
        identity,
        expectedByteSize: inspected.byteSize,
        expectedSha256: inspected.sha256,
        expectedImmutableIdentityHash: inspected.immutableIdentityHash,
      }),
    ).resolves.toEqual({ disposition: "deleted" });

    const rootAfterDirectorySync = await temporaryRoot("crash-dir");
    const durableCrash = await createAdapter(
      rootAfterDirectorySync,
      (checkpoint) => {
        if (checkpoint === "after_directory_fsync") {
          throw new Error("crash");
        }
      },
    );
    await expect(
      durableCrash.writeObject({
        identity,
        maximumBytes: "16",
        body: chunks("durable"),
      }),
    ).rejects.toBeInstanceOf(LocalStorageSimulatedCrashError);
    const recoveredDurable = await createAdapter(rootAfterDirectorySync);
    await expect(
      recoveredDurable.inspectObject(identity),
    ).resolves.toMatchObject({
      byteSize: "7",
      sha256: sha256("durable"),
    });
  });

  it("rejects non-regular final objects and preserves typed errors", async () => {
    const root = await temporaryRoot("non-regular");
    const outside = await temporaryRoot("final-symlink");
    const adapter = await createAdapter(root);
    const finalPath = join(root, "artifacts", "v1", "workspace", "output.bin");
    await mkdir(finalPath, { recursive: true, mode: 0o700 });
    await expect(adapter.inspectObject(identity)).rejects.toBeInstanceOf(
      LocalFilesystemStorageError,
    );
    await expect(adapter.inspectObject(identity)).rejects.toMatchObject({
      code: "local_storage.object_not_regular",
    });
    await rm(finalPath, { recursive: true });
    const outsideFile = join(outside, "outside.bin");
    await writeFile(outsideFile, "outside", { mode: 0o600 });
    await symlink(outsideFile, finalPath);
    await expect(adapter.inspectObject(identity)).rejects.toMatchObject({
      code: "local_storage.path_unsafe",
    });
  });
});
