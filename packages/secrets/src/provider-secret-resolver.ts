import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

import type {
  PinnedEncryptedDatabaseSecretMetadata,
  PinnedSecretVersionMetadata,
} from "@kanvas/database/runtime";

const canonicalDigestPattern = /^sha256:[0-9a-f]{64}$/u;
const maximumSecretBytes = 65_536;

export interface ProviderSecretMaterialResolver {
  withResolvedMaterial<TResult>(
    metadata: PinnedSecretVersionMetadata,
    use: (material: Uint8Array) => Promise<TResult>,
  ): Promise<TResult>;
}

export interface CreateProviderSecretMaterialResolverOptions {
  readonly deploymentSecretFiles: Readonly<Record<string, string>>;
  readonly kekValues?: Readonly<Record<string, string>>;
  readonly kekFiles: Readonly<Record<string, string>>;
}

export class ProviderSecretResolutionError extends Error {
  readonly code = "provider.secret_resolution_failed";

  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderSecretResolutionError";
  }
}

function fail(message: string, cause?: unknown): never {
  throw new ProviderSecretResolutionError(
    message,
    cause === undefined ? undefined : { cause },
  );
}

async function readBoundedFile(path: string, label: string): Promise<Buffer> {
  let value: Buffer;
  try {
    value = await readFile(path);
  } catch (error) {
    return fail(`${label} is unavailable.`, error);
  }
  if (value.byteLength < 1 || value.byteLength > maximumSecretBytes) {
    value.fill(0);
    return fail(`${label} has an invalid byte length.`);
  }
  return value;
}

function verifyFingerprint(material: Uint8Array, expected: string): void {
  if (!canonicalDigestPattern.test(expected)) {
    fail("Pinned secret fingerprint is invalid.");
  }
  const actual = Buffer.from(
    `sha256:${createHash("sha256").update(material).digest("hex")}`,
    "ascii",
  );
  const expectedBytes = Buffer.from(expected, "ascii");
  const equal =
    actual.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actual, expectedBytes);
  actual.fill(0);
  expectedBytes.fill(0);
  if (!equal) {
    fail("Resolved secret material does not match its pinned fingerprint.");
  }
}

function decodeBase64(value: string, label: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength < 1) {
    return fail(`${label} is invalid.`);
  }
  return decoded;
}

function decryptAesGcm(
  ciphertext: Buffer,
  key: Buffer,
  nonce: Buffer,
  authTag: Buffer,
  aad: Buffer,
  label: string,
): Buffer {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, {
      authTagLength: authTag.byteLength,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    return fail(`${label} authentication failed.`, error);
  }
}

async function resolveEncryptedMaterial(
  metadata: PinnedEncryptedDatabaseSecretMetadata,
  kekFiles: Readonly<Record<string, string>>,
  kekValues?: Readonly<Record<string, string>>,
): Promise<Buffer> {
  const kekPath = kekFiles[metadata.envelope.kekVersion];
  const direct = kekValues?.[metadata.envelope.kekVersion];
  if (!kekPath && !direct) {
    return fail("Pinned KEK version is not mapped in this deployment.");
  }
  const encodedKek = direct
    ? Buffer.from(direct, "utf8")
    : await readBoundedFile(kekPath ?? "", "Provider KEK");
  let kek: Buffer | undefined;
  let wrappedDek: Buffer | undefined;
  let wrapNonce: Buffer | undefined;
  let wrapAuthTag: Buffer | undefined;
  let materialCiphertext: Buffer | undefined;
  let materialNonce: Buffer | undefined;
  let materialAuthTag: Buffer | undefined;
  let dek: Buffer | undefined;
  let wrapAad: Buffer | undefined;
  let materialAad: Buffer | undefined;
  try {
    kek = Buffer.from(encodedKek.toString("utf8").trim(), "base64");
    if (kek.byteLength !== 32) {
      return fail("Provider KEK must be a base64-encoded 256-bit key.");
    }
    wrappedDek = decodeBase64(
      metadata.envelope.wrappedDekBase64,
      "Wrapped DEK",
    );
    wrapNonce = decodeBase64(
      metadata.envelope.wrapNonceBase64,
      "Wrapped DEK nonce",
    );
    wrapAuthTag = decodeBase64(
      metadata.envelope.wrapAuthTagBase64,
      "Wrapped DEK authentication tag",
    );
    wrapAad = Buffer.from(
      `${metadata.aadDigest}\0wrap-dek\0${metadata.envelope.kekVersion}`,
      "utf8",
    );
    dek = decryptAesGcm(
      wrappedDek,
      kek,
      wrapNonce,
      wrapAuthTag,
      wrapAad,
      "Wrapped DEK",
    );
    if (dek.byteLength !== 32) {
      return fail("Unwrapped Provider DEK is not 256 bits.");
    }
    materialCiphertext = decodeBase64(
      metadata.envelope.materialCiphertextBase64,
      "Secret ciphertext",
    );
    materialNonce = decodeBase64(
      metadata.envelope.materialNonceBase64,
      "Secret nonce",
    );
    materialAuthTag = decodeBase64(
      metadata.envelope.materialAuthTagBase64,
      "Secret authentication tag",
    );
    materialAad = Buffer.from(
      `${metadata.aadDigest}\0material\0${String(metadata.formatVersion)}`,
      "utf8",
    );
    return decryptAesGcm(
      materialCiphertext,
      dek,
      materialNonce,
      materialAuthTag,
      materialAad,
      "Secret material",
    );
  } finally {
    encodedKek.fill(0);
    kek?.fill(0);
    wrappedDek?.fill(0);
    wrapNonce?.fill(0);
    wrapAuthTag?.fill(0);
    materialCiphertext?.fill(0);
    materialNonce?.fill(0);
    materialAuthTag?.fill(0);
    dek?.fill(0);
    wrapAad?.fill(0);
    materialAad?.fill(0);
  }
}

export function createProviderSecretMaterialResolver(
  options: CreateProviderSecretMaterialResolverOptions,
): ProviderSecretMaterialResolver {
  return Object.freeze({
    async withResolvedMaterial<TResult>(
      metadata: PinnedSecretVersionMetadata,
      use: (material: Uint8Array) => Promise<TResult>,
    ): Promise<TResult> {
      let material: Buffer;
      if (metadata.sourceKind === "deployment_reference") {
        const path =
          options.deploymentSecretFiles[metadata.deploymentReference];
        if (!path) {
          return fail("Pinned deployment secret reference is not mapped.");
        }
        material = await readBoundedFile(path, "Provider deployment secret");
      } else if (metadata.sourceKind === "plaintext_database") {
        material = decodeBase64(
          metadata.plaintext.materialPlaintextBase64,
          "Plaintext database secret",
        );
        if (material.byteLength > maximumSecretBytes) {
          material.fill(0);
          return fail("Plaintext database secret has an invalid byte length.");
        }
      } else {
        material = await resolveEncryptedMaterial(
          metadata,
          options.kekFiles,
          options.kekValues,
        );
      }
      try {
        verifyFingerprint(material, metadata.materialFingerprint);
        return await use(material);
      } finally {
        material.fill(0);
      }
    },
  });
}
