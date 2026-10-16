import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  PinnedDeploymentSecretMetadata,
  PinnedSecretVersionMetadata,
} from "@kanvas/database/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { createProviderSecretMaterialResolver } from "../src/index.js";

const temporaryDirectories: string[] = [];
const digest = (value: Uint8Array | string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

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

async function temporaryFile(
  name: string,
  value: Uint8Array | string,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kanvas-provider-secret-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, value);
  return path;
}

function encrypt(
  plaintext: Buffer,
  key: Buffer,
  nonce: Buffer,
  aad: Buffer,
): {
  readonly ciphertextBase64: string;
  readonly authTagBase64: string;
} {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertextBase64: ciphertext.toString("base64"),
    authTagBase64: cipher.getAuthTag().toString("base64"),
  };
}

const commonMetadata = {
  id: "01K00000000000000000000001",
  workspaceId: "01K00000000000000000000002",
  credentialId: "01K00000000000000000000003",
  version: 1,
  materialGeneration: 1,
  lifecycleStatus: "active" as const,
  aadDigest: digest("provider-secret-aad"),
  formatVersion: 1,
  drainDeadlineAt: null,
};

describe("Provider secret material resolver", () => {
  it("resolves a mounted deployment secret and zeroes it after callback scope", async () => {
    const secret = Buffer.from("sk-test-deployment-secret", "utf8");
    const path = await temporaryFile("provider-secret", secret);
    const metadata = Object.freeze<PinnedSecretVersionMetadata>({
      ...commonMetadata,
      sourceKind: "deployment_reference",
      deploymentReference: "deployment://provider/openai",
      materialFingerprint: digest(secret),
    });
    const resolver = createProviderSecretMaterialResolver({
      deploymentSecretFiles: {
        "deployment://provider/openai": path,
      },
      kekFiles: {},
    });
    let callbackMaterial: Uint8Array | undefined;

    await expect(
      resolver.withResolvedMaterial(metadata, (material) => {
        callbackMaterial = material;
        expect(Buffer.from(material).toString("utf8")).toBe(
          secret.toString("utf8"),
        );
        return Promise.resolve("used");
      }),
    ).resolves.toBe("used");
    expect(callbackMaterial).toBeDefined();
    expect([...(callbackMaterial ?? [])].every((byte) => byte === 0)).toBe(
      true,
    );
  });

  it("decrypts an authenticated database envelope and zeroes the plaintext", async () => {
    const material = Buffer.from("sk-test-encrypted-secret", "utf8");
    const kek = randomBytes(32);
    const dek = randomBytes(32);
    const wrapNonce = randomBytes(12);
    const materialNonce = randomBytes(12);
    const kekVersion = "kek-v1";
    const wrapAad = Buffer.from(
      `${commonMetadata.aadDigest}\0wrap-dek\0${kekVersion}`,
      "utf8",
    );
    const materialAad = Buffer.from(
      `${commonMetadata.aadDigest}\0material\0${String(
        commonMetadata.formatVersion,
      )}`,
      "utf8",
    );
    const wrapped = encrypt(dek, kek, wrapNonce, wrapAad);
    const encryptedMaterial = encrypt(
      material,
      dek,
      materialNonce,
      materialAad,
    );
    const kekPath = await temporaryFile("kek", kek.toString("base64"));
    const metadata = Object.freeze<PinnedSecretVersionMetadata>({
      ...commonMetadata,
      sourceKind: "encrypted_database",
      materialFingerprint: digest(material),
      envelope: {
        materialCiphertextBase64: encryptedMaterial.ciphertextBase64,
        materialNonceBase64: materialNonce.toString("base64"),
        materialAuthTagBase64: encryptedMaterial.authTagBase64,
        wrappedDekBase64: wrapped.ciphertextBase64,
        wrapNonceBase64: wrapNonce.toString("base64"),
        wrapAuthTagBase64: wrapped.authTagBase64,
        kekVersion,
      },
    });
    let missingKeyCallbackInvoked = false;
    await expect(
      createProviderSecretMaterialResolver({
        deploymentSecretFiles: {},
        kekFiles: {},
      }).withResolvedMaterial(metadata, () => {
        missingKeyCallbackInvoked = true;
        return Promise.resolve();
      }),
    ).rejects.toMatchObject({ code: "provider.secret_resolution_failed" });
    expect(missingKeyCallbackInvoked).toBe(false);
    const resolver = createProviderSecretMaterialResolver({
      deploymentSecretFiles: {},
      kekFiles: {
        [kekVersion]: kekPath,
      },
    });
    let callbackMaterial: Uint8Array | undefined;

    await resolver.withResolvedMaterial(metadata, (resolved) => {
      callbackMaterial = resolved;
      expect(Buffer.from(resolved)).toEqual(material);
      return Promise.resolve();
    });
    expect([...(callbackMaterial ?? [])].every((byte) => byte === 0)).toBe(
      true,
    );
  });

  it("fails closed for an unmapped reference or fingerprint mismatch", async () => {
    const secret = Buffer.from("sk-test-wrong-fingerprint", "utf8");
    const path = await temporaryFile("provider-secret", secret);
    const resolver = createProviderSecretMaterialResolver({
      deploymentSecretFiles: {
        "deployment://provider/openai": path,
      },
      kekFiles: {},
    });
    const metadata = Object.freeze<PinnedDeploymentSecretMetadata>({
      ...commonMetadata,
      sourceKind: "deployment_reference",
      deploymentReference: "deployment://provider/openai",
      materialFingerprint: digest("different"),
    });

    await expect(
      resolver.withResolvedMaterial(metadata, () => Promise.resolve()),
    ).rejects.toMatchObject({
      code: "provider.secret_resolution_failed",
    });
    await expect(
      resolver.withResolvedMaterial(
        {
          ...metadata,
          deploymentReference: "deployment://provider/missing",
        },
        () => Promise.resolve(),
      ),
    ).rejects.toMatchObject({
      code: "provider.secret_resolution_failed",
    });
  });
});
