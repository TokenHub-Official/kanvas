import { describe, expect, it } from "vitest";

import {
  createBackupSetEnvelope,
  parseBackupSetEnvelope,
  type BackupSetManifestV1,
} from "../src/index.js";

function manifest(): BackupSetManifestV1 {
  return {
    schemaVersion: 1,
    backupSetId: "01K00000000000000000000001",
    deploymentId: "deployment-v0",
    createdAt: "2026-07-28T20:00:00.000Z",
    runtime: {
      state: "MAINTENANCE",
      executionGeneration: 9,
      stateVersion: 12,
    },
    database: {
      snapshotId: "mysql-snapshot-20260728",
      snapshotSha256: `sha256:${"1".repeat(64)}`,
      position: {
        mode: "binlog",
        file: "binlog.000017",
        position: "9842",
      },
      migrationInventoryDigest: `sha256:${"2".repeat(64)}`,
      migrations: [
        {
          name: "0000_initial_schema.sql",
          checksum: "3".repeat(64),
        },
        {
          name: "0001_example_change.sql",
          checksum: "4".repeat(64),
        },
      ],
    },
    objects: {
      storageProfileId: "01K00000000000000000000002",
      storageKind: "local",
      coverageMode: "quiesced_local_snapshot",
      checkpointId: "local-snapshot-20260728",
      inventoryDigest: `sha256:${"5".repeat(64)}`,
      storedObjectReferenceCount: "42",
    },
    keyReferences: {
      kekVersions: ["kek-v1", "kek-v2"],
      deploymentSecretReferenceCount: "1",
    },
    configuration: {
      configManifestDigest: `sha256:${"6".repeat(64)}`,
    },
    images: {
      app: `sha256:${"7".repeat(64)}`,
      web: `sha256:${"8".repeat(64)}`,
      mysql: `sha256:${"9".repeat(64)}`,
      redis: `sha256:${"a".repeat(64)}`,
    },
    declaredRpoClass: "named-backup-only",
    verification: {
      status: "created",
    },
  };
}

describe("BackupSet manifest", () => {
  it("creates and parses one deterministic secret-free envelope", () => {
    const first = createBackupSetEnvelope(manifest());
    const second = createBackupSetEnvelope({
      ...manifest(),
      runtime: {
        state: "MAINTENANCE",
        stateVersion: 12,
        executionGeneration: 9,
      },
    });

    expect(first.manifestDigest).toBe(second.manifestDigest);
    expect(parseBackupSetEnvelope(first)).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(
      /password|credential|ciphertext|secretValue/iu,
    );
  });

  it("rejects tampering, unsorted authority facts, and undeclared fields", () => {
    const envelope = createBackupSetEnvelope(manifest());
    expect(() =>
      parseBackupSetEnvelope({
        ...envelope,
        manifest: {
          ...envelope.manifest,
          deploymentId: "changed",
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "backup_manifest.digest_mismatch",
      }),
    );

    expect(() =>
      createBackupSetEnvelope({
        ...manifest(),
        keyReferences: {
          ...manifest().keyReferences,
          kekVersions: ["kek-v2", "kek-v1"],
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "backup_manifest.invalid",
      }),
    );

    expect(() =>
      parseBackupSetEnvelope({
        ...envelope,
        password: "must-not-be-accepted",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "backup_manifest.invalid",
      }),
    );
  });

  it("requires real quiesced/version coverage semantics for each storage kind", () => {
    expect(() =>
      createBackupSetEnvelope({
        ...manifest(),
        objects: {
          ...manifest().objects,
          storageKind: "s3",
          coverageMode: "quiesced_local_snapshot",
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "backup_manifest.invalid",
      }),
    );
  });
});
