import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  PinnedEncryptedDatabaseSecretMetadata,
  PinnedPlaintextDatabaseSecretMetadata,
} from "@kanvas/database/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  createProviderSecretDatabaseWriter,
  createProviderSecretMaterialResolver,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

async function temporaryKekFile(kek: Buffer): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kanvas-provider-kek-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "kek");
  await writeFile(path, kek.toString("base64"), {
    mode: 0o600,
  });
  return path;
}

const identity = Object.freeze({
  instanceId: "kanvas-test",
  workspaceId: "01K00000000000000000000001",
  credentialId: "01K00000000000000000000002",
  secretVersionId: "01K00000000000000000000003",
  providerKind: "tokenhub",
  formatVersion: 1,
});

describe("Provider secret database writer", () => {
  it("reports deployment readiness without exposing the KEK path", async () => {
    const path = await temporaryKekFile(randomBytes(32));
    const writer = createProviderSecretDatabaseWriter({
      activeKekVersion: "provider-kek-v1",
      kekFiles: {
        "provider-kek-v1": path,
      },
    });

    expect(writer.readiness()).toEqual({
      ready: true,
      mode: "encrypted_database",
      kekVersion: "provider-kek-v1",
    });
    expect(JSON.stringify(writer.readiness())).not.toContain(path);
  });

  it.each(["file", "environment"])(
    "round-trips an authenticated envelope through %s credentials",
    async (source) => {
      const value = randomBytes(32).toString("base64");
      const path = await temporaryKekFile(Buffer.from(value, "base64"));
      const sources =
        source === "file"
          ? { kekFiles: { "provider-kek-v1": path } }
          : { kekFiles: {}, kekValues: { "provider-kek-v1": value } };
      const writer = createProviderSecretDatabaseWriter({
        activeKekVersion: "provider-kek-v1",
        ...sources,
      });
      const material = Buffer.from("sk-provider-test", "utf8");
      const encrypted = await writer.prepare(identity, material);
      expect(encrypted.source.kind).toBe("encrypted_database");
      if (encrypted.source.kind !== "encrypted_database") {
        throw new Error("Expected encrypted database storage.");
      }
      const metadata = Object.freeze<PinnedEncryptedDatabaseSecretMetadata>({
        id: identity.secretVersionId,
        workspaceId: identity.workspaceId,
        credentialId: identity.credentialId,
        version: 1,
        materialGeneration: 1,
        sourceKind: "encrypted_database",
        lifecycleStatus: "active",
        aadDigest: encrypted.aadDigest,
        materialFingerprint: encrypted.materialFingerprint,
        formatVersion: identity.formatVersion,
        drainDeadlineAt: null,
        envelope: encrypted.source.envelope,
      });
      const resolver = createProviderSecretMaterialResolver({
        deploymentSecretFiles: {},
        ...sources,
      });

      await expect(
        resolver.withResolvedMaterial(metadata, (resolved) => {
          expect(Buffer.from(resolved).toString("utf8")).toBe(
            "sk-provider-test",
          );
          return Promise.resolve("resolved");
        }),
      ).resolves.toBe("resolved");
      expect(JSON.stringify(encrypted)).not.toContain("sk-provider-test");
    },
  );

  it("stores and resolves plaintext database material when no KEK is configured", async () => {
    const writer = createProviderSecretDatabaseWriter({
      kekFiles: {},
    });

    expect(writer.readiness()).toEqual({
      ready: true,
      mode: "plaintext_database",
    });
    const material = Buffer.from("sk-plaintext-test", "utf8");
    const prepared = await writer.prepare(identity, material);
    expect(prepared.source.kind).toBe("plaintext_database");
    if (prepared.source.kind !== "plaintext_database") {
      throw new Error("Expected plaintext database storage.");
    }
    const metadata = Object.freeze<PinnedPlaintextDatabaseSecretMetadata>({
      id: identity.secretVersionId,
      workspaceId: identity.workspaceId,
      credentialId: identity.credentialId,
      version: 1,
      materialGeneration: 1,
      sourceKind: "plaintext_database",
      lifecycleStatus: "active",
      aadDigest: prepared.aadDigest,
      materialFingerprint: prepared.materialFingerprint,
      formatVersion: identity.formatVersion,
      drainDeadlineAt: null,
      plaintext: prepared.source.plaintext,
    });
    const resolver = createProviderSecretMaterialResolver({
      deploymentSecretFiles: {},
      kekFiles: {},
    });

    await expect(
      resolver.withResolvedMaterial(metadata, (resolved) => {
        expect(Buffer.from(resolved).toString("utf8")).toBe(
          "sk-plaintext-test",
        );
        return Promise.resolve("resolved");
      }),
    ).resolves.toBe("resolved");
  });
});
