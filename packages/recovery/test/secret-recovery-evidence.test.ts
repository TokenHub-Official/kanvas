import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  verifySecretRecoveryEvidence,
  type BackupSetManifestV1,
  type DeploymentSecretRecoveryFact,
  type EncryptedSecretRecoveryFact,
} from "../src/index.js";

const encryptedRow = Object.freeze({
  id: "01K00000000000000000000001",
  workspaceId: "01K00000000000000000000002",
  credentialId: "01K00000000000000000000003",
  version: 1,
  materialGeneration: 1,
  sourceKind: "encrypted_database",
  lifecycleStatus: "active",
  materialCiphertextBase64: "Y2lwaGVydGV4dA==",
  materialNonceBase64: "bm9uY2U=",
  materialAuthTagBase64: "YXV0aC10YWc=",
  wrappedDekBase64: "d3JhcHBlZC1kZWs=",
  wrapNonceBase64: "d3JhcC1ub25jZQ==",
  wrapAuthTagBase64: "d3JhcC10YWc=",
  kekVersion: "kek-v1",
  aadDigest: `sha256:${"1".repeat(64)}`,
  deploymentReference: null,
  materialFingerprint: `sha256:${"2".repeat(64)}`,
  formatVersion: 1,
  drainDeadlineAt: null,
});

const deploymentRow = Object.freeze({
  id: "01K00000000000000000000004",
  workspaceId: "01K00000000000000000000002",
  credentialId: "01K00000000000000000000005",
  version: 1,
  materialGeneration: 1,
  sourceKind: "deployment_reference",
  lifecycleStatus: "active",
  materialCiphertextBase64: null,
  materialNonceBase64: null,
  materialAuthTagBase64: null,
  wrappedDekBase64: null,
  wrapNonceBase64: null,
  wrapAuthTagBase64: null,
  kekVersion: null,
  aadDigest: `sha256:${"3".repeat(64)}`,
  deploymentReference: "env:KANVAS_PROVIDER_TOKEN",
  materialFingerprint: `sha256:${"4".repeat(64)}`,
  formatVersion: 1,
  drainDeadlineAt: null,
});

function poolFor(rows: readonly object[]): Pool {
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

function manifest(options: {
  readonly kekVersions: readonly string[];
  readonly deploymentReferenceCount: string;
}): BackupSetManifestV1 {
  return {
    keyReferences: {
      kekVersions: options.kekVersions,
      deploymentSecretReferenceCount: options.deploymentReferenceCount,
    },
  } as BackupSetManifestV1;
}

describe("Secret recovery evidence", () => {
  it("proves every encrypted and deployment-backed secret reference", async () => {
    const verifyEncryptedSecret = vi.fn<
      (fact: EncryptedSecretRecoveryFact) => Promise<void>
    >(() => Promise.resolve());
    const verifyDeploymentSecretReference = vi.fn<
      (fact: DeploymentSecretRecoveryFact) => Promise<void>
    >(() => Promise.resolve());

    const evidence = await verifySecretRecoveryEvidence({
      pool: poolFor([encryptedRow, deploymentRow]),
      manifest: manifest({
        kekVersions: ["kek-v1"],
        deploymentReferenceCount: "1",
      }),
      verifyEncryptedSecret,
      verifyDeploymentSecretReference,
    });

    expect(evidence).toMatchObject({
      encryptedSecretVersionCount: "1",
      deploymentSecretReferenceCount: "1",
      kekVersions: ["kek-v1"],
    });
    expect(evidence.secretReferenceInventoryDigest).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
    expect(verifyEncryptedSecret).toHaveBeenCalledOnce();
    expect(verifyDeploymentSecretReference).toHaveBeenCalledOnce();
  });

  it("does not claim recoverability without a KEK verifier", async () => {
    await expect(
      verifySecretRecoveryEvidence({
        pool: poolFor([encryptedRow]),
        manifest: manifest({
          kekVersions: ["kek-v1"],
          deploymentReferenceCount: "0",
        }),
      }),
    ).rejects.toMatchObject({
      code: "recovery_verification.secret_unverifiable",
    });
  });
});
