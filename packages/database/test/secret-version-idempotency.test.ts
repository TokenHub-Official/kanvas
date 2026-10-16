import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createSecretVersionStore } from "../src/runtime/secret-version-store.js";

const workspaceId = "01K00000000000000000000001";
const organizationId = "01K00000000000000000000002";
const credentialId = "01K00000000000000000000003";
const endpointId = "01K00000000000000000000004";
const secretVersionId = "01K00000000000000000000005";
const principalId = "01K00000000000000000000006";
const digest = `sha256:${"a".repeat(64)}`;
const now = new Date("2026-08-27T05:00:00.000Z");

const credential = {
  organizationId,
  workspaceId,
  id: credentialId,
  providerEndpointId: endpointId,
  providerKind: "pexels.v1",
  identityDigest: digest,
  identityEpoch: 1,
  materialGeneration: 1,
  activeSecretVersionId: secretVersionId,
  lifecycleStatus: "active",
  version: 2,
};

const secret = {
  id: secretVersionId,
  workspaceId,
  credentialId,
  version: 1,
  materialGeneration: 1,
  sourceKind: "plaintext_database",
  lifecycleStatus: "active",
  materialPlaintextBase64: Buffer.from("key").toString("base64"),
  materialCiphertextBase64: null,
  materialNonceBase64: null,
  materialAuthTagBase64: null,
  wrappedDekBase64: null,
  wrapNonceBase64: null,
  wrapAuthTagBase64: null,
  kekVersion: null,
  aadDigest: digest,
  deploymentReference: null,
  materialFingerprint: digest,
  formatVersion: 1,
  drainDeadlineAt: null,
};

const audit = {
  auditEventId: "01K00000000000000000000007",
  actorPrincipalId: principalId,
  actorType: "human" as const,
  authenticationRefType: "session" as const,
  authenticationRefHash: digest,
  authorityType: "human_membership" as const,
  authorityId: "01K00000000000000000000008",
  authorityVersion: 1,
};

function poolFor(results: readonly unknown[]): Pool {
  const queue = [...results];
  const connection = {
    beginTransaction: vi.fn(() => Promise.resolve()),
    commit: vi.fn(() => Promise.resolve()),
    rollback: vi.fn(() => Promise.resolve()),
    release: vi.fn(),
    execute: vi.fn((query: string, values?: readonly unknown[]) => {
      void query;
      void values;
      const next = queue.shift();
      if (next === undefined) {
        return Promise.reject(new Error("Unexpected SQL execution."));
      }
      return Promise.resolve(next);
    }),
  } as unknown as PoolConnection;
  return {
    getConnection: vi.fn(() => Promise.resolve(connection)),
  } as unknown as Pool;
}

describe("SecretVersion idempotency", () => {
  it("replays create, verify, and rotate after the candidate is already active", async () => {
    const createStore = createSecretVersionStore(
      poolFor([
        [[credential], []],
        [[secret], []],
      ]),
    );
    await expect(
      createStore.create({
        workspaceId,
        credentialId,
        secretVersionId,
        expectedCredentialVersion: 2,
        source: {
          kind: "plaintext_database",
          plaintext: {
            materialPlaintextBase64: Buffer.from("key").toString("base64"),
          },
        },
        aadDigest: digest,
        materialFingerprint: digest,
        formatVersion: 1,
        createdByPrincipalId: principalId,
        now,
        audit,
      }),
    ).resolves.toMatchObject({ lifecycleStatus: "active" });

    const verifyStore = createSecretVersionStore(
      poolFor([
        [[credential], []],
        [[secret], []],
      ]),
    );
    await expect(
      verifyStore.verify({
        workspaceId,
        credentialId,
        secretVersionId,
        expectedCredentialVersion: 2,
        now,
        audit,
      }),
    ).resolves.toMatchObject({ lifecycleStatus: "active" });

    const rotateStore = createSecretVersionStore(
      poolFor([
        [[credential], []],
        [[secret], []],
      ]),
    );
    await expect(
      rotateStore.rotateActive({
        workspaceId,
        credentialId,
        candidateSecretVersionId: secretVersionId,
        expectedCredentialVersion: 2,
        previousDrainDeadlineAt: new Date(now.getTime() + 60_000),
        now,
        audit,
      }),
    ).resolves.toMatchObject({ lifecycleStatus: "active" });
  });
});
