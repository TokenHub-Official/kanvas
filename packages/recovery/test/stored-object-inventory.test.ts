import type { StorageObjectIdentity, StoragePort } from "@kanvas/application";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { verifyStoredObjectInventory } from "../src/index.js";

const profileId = "01K00000000000000000000001";

interface TestStoredObjectRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId: string | null;
  readonly immutableIdentityHash: string;
  readonly byteSize: string;
  readonly sha256: string;
  readonly deleteState: "active" | "deletion_pending";
}

const row: TestStoredObjectRow = Object.freeze({
  id: "01K00000000000000000000010",
  workspaceId: "01K00000000000000000000002",
  storageProfileId: profileId,
  container: "objects",
  objectKey: "workspaces/example/image.png",
  storageVersionId: null,
  immutableIdentityHash: `sha256:${"1".repeat(64)}`,
  byteSize: "12",
  sha256: "2".repeat(64),
  deleteState: "active",
});

function poolFor(rows: readonly TestStoredObjectRow[]): Pool {
  let returned = false;
  return {
    query: vi.fn(() => {
      if (returned) {
        return Promise.resolve([[], []]);
      }
      returned = true;
      return Promise.resolve([[...rows], []]);
    }),
  } as unknown as Pool;
}

function storageFor(inspectObject: StoragePort["inspectObject"]): StoragePort {
  return {
    storageProfileId: profileId,
    kind: "local",
    capabilities: {
      uploadModes: ["server_stream"],
      writeProtectionModes: ["server_owned"],
      multipart: false,
      fullObjectChecksum: true,
      rangeRead: true,
      versionBoundIdentity: false,
      sealedIdentityImmutable: true,
      deploymentScope: "single_node",
      maximumObjectBytes: "9007199254740991",
      serverSideEncryption: "not_provided",
    },
    writeObject: vi.fn(),
    sealObject: vi.fn(),
    inspectObject,
    openRead: vi.fn(),
    deleteObject: vi.fn(),
    cleanupUnpublishedObject: vi.fn(),
  };
}

describe("StoredObject recovery inventory", () => {
  it("hashes deterministic database facts and verifies every object byte identity", async () => {
    const inspectObject = vi.fn((identity: StorageObjectIdentity) =>
      Promise.resolve({
        identity,
        byteSize: row.byteSize,
        sha256: row.sha256,
        immutableIdentityHash: row.immutableIdentityHash,
      }),
    );
    const evidence = await verifyStoredObjectInventory({
      pool: poolFor([row]),
      storage: storageFor(inspectObject),
      batchSize: 10,
      verificationConcurrency: 2,
    });

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      storedObjectReferenceCount: "1",
      verifiedObjectCount: "1",
    });
    expect(evidence.inventoryDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(inspectObject).toHaveBeenCalledOnce();
  });

  it("fails closed for a missing or changed referenced object", async () => {
    await expect(
      verifyStoredObjectInventory({
        pool: poolFor([row]),
        storage: storageFor(() => Promise.resolve(undefined)),
      }),
    ).rejects.toMatchObject({
      code: "recovery_inventory.object_missing",
    });

    await expect(
      verifyStoredObjectInventory({
        pool: poolFor([row]),
        storage: storageFor((identity) =>
          Promise.resolve({
            identity,
            byteSize: "13",
            sha256: row.sha256,
            immutableIdentityHash: row.immutableIdentityHash,
          }),
        ),
      }),
    ).rejects.toMatchObject({
      code: "recovery_inventory.object_identity_mismatch",
    });
  });

  it("rejects a profile mismatch before trusting another adapter", async () => {
    const inspectObject = vi.fn();
    await expect(
      verifyStoredObjectInventory({
        pool: poolFor([
          {
            ...row,
            storageProfileId: "01K00000000000000000000003",
          },
        ]),
        storage: storageFor(inspectObject),
      }),
    ).rejects.toMatchObject({
      code: "recovery_inventory.profile_mismatch",
    });
    expect(inspectObject).not.toHaveBeenCalled();
  });
});
