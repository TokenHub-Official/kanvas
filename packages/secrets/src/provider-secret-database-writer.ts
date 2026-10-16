import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  secretAadDigestFor,
  type EncryptedSecretEnvelope,
  type PlaintextDatabaseSecret,
} from "@kanvas/database/runtime";

const maximumSecretBytes = 65_536;

export interface ProviderSecretIdentity {
  readonly instanceId: string;
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly secretVersionId: string;
  readonly providerKind: string;
  readonly formatVersion: number;
}

export type ProviderDatabaseSecretSource =
  | {
      readonly kind: "plaintext_database";
      readonly plaintext: PlaintextDatabaseSecret;
    }
  | {
      readonly kind: "encrypted_database";
      readonly envelope: EncryptedSecretEnvelope;
    };

export interface PreparedProviderSecret {
  readonly aadDigest: string;
  readonly materialFingerprint: string;
  readonly source: ProviderDatabaseSecretSource;
}

export interface ProviderSecretDatabaseWriter {
  readiness(): {
    readonly ready: true;
    readonly mode: "plaintext_database" | "encrypted_database";
    readonly kekVersion?: string;
  };
  prepare(
    identity: ProviderSecretIdentity,
    material: Uint8Array,
  ): Promise<PreparedProviderSecret>;
}

export interface CreateProviderSecretDatabaseWriterOptions {
  readonly activeKekVersion?: string;
  readonly kekValues?: Readonly<Record<string, string>>;
  readonly kekFiles: Readonly<Record<string, string>>;
}

export class ProviderSecretPersistenceError extends Error {
  readonly code = "provider.secret_persistence_failed";

  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderSecretPersistenceError";
  }
}

function fail(message: string, cause?: unknown): never {
  throw new ProviderSecretPersistenceError(
    message,
    cause === undefined ? undefined : { cause },
  );
}

function encryptAesGcm(
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
  try {
    return Object.freeze({
      ciphertextBase64: ciphertext.toString("base64"),
      authTagBase64: cipher.getAuthTag().toString("base64"),
    });
  } finally {
    ciphertext.fill(0);
  }
}

async function loadKek(path: string, direct?: string): Promise<Buffer> {
  let encoded: Buffer;
  try {
    encoded =
      direct === undefined ? await readFile(path) : Buffer.from(direct, "utf8");
  } catch (error) {
    return fail("The active Provider KEK is unavailable.", error);
  }
  try {
    const kek = Buffer.from(encoded.toString("utf8").trim(), "base64");
    if (kek.byteLength !== 32) {
      kek.fill(0);
      return fail(
        "The active Provider KEK must be a base64-encoded 256-bit key.",
      );
    }
    return kek;
  } finally {
    encoded.fill(0);
  }
}

export function createProviderSecretDatabaseWriter(
  options: CreateProviderSecretDatabaseWriterOptions,
): ProviderSecretDatabaseWriter {
  const activeKekVersion = options.activeKekVersion?.trim();
  const activeKekPath = activeKekVersion
    ? options.kekFiles[activeKekVersion] ||
      (options.kekValues?.[activeKekVersion] ? "environment" : undefined)
    : undefined;

  return Object.freeze({
    readiness(): {
      readonly ready: true;
      readonly mode: "plaintext_database" | "encrypted_database";
      readonly kekVersion?: string;
    } {
      return activeKekVersion && activeKekPath
        ? Object.freeze({
            ready: true,
            mode: "encrypted_database" as const,
            kekVersion: activeKekVersion,
          })
        : Object.freeze({
            ready: true,
            mode: "plaintext_database" as const,
          });
    },

    async prepare(
      identity: ProviderSecretIdentity,
      material: Uint8Array,
    ): Promise<PreparedProviderSecret> {
      if (material.byteLength < 1 || material.byteLength > maximumSecretBytes) {
        return fail("Provider secret material has an invalid byte length.");
      }

      const plaintext = Buffer.from(material);
      const aadDigest = secretAadDigestFor(identity);
      const materialFingerprint = `sha256:${createHash("sha256")
        .update(plaintext)
        .digest("hex")}`;
      if (!activeKekVersion || !activeKekPath) {
        try {
          return Object.freeze({
            aadDigest,
            materialFingerprint,
            source: Object.freeze({
              kind: "plaintext_database" as const,
              plaintext: Object.freeze({
                materialPlaintextBase64: plaintext.toString("base64"),
              }),
            }),
          });
        } finally {
          plaintext.fill(0);
        }
      }
      const dek = randomBytes(32);
      const materialNonce = randomBytes(12);
      const wrapNonce = randomBytes(12);
      const materialAad = Buffer.from(
        `${aadDigest}\0material\0${String(identity.formatVersion)}`,
        "utf8",
      );
      const wrapAad = Buffer.from(
        `${aadDigest}\0wrap-dek\0${activeKekVersion}`,
        "utf8",
      );
      let kek: Buffer | undefined;
      try {
        kek = await loadKek(
          activeKekPath,
          activeKekVersion ? options.kekValues?.[activeKekVersion] : undefined,
        );
        const encryptedMaterial = encryptAesGcm(
          plaintext,
          dek,
          materialNonce,
          materialAad,
        );
        const wrappedDek = encryptAesGcm(dek, kek, wrapNonce, wrapAad);
        return Object.freeze({
          aadDigest,
          materialFingerprint,
          source: Object.freeze({
            kind: "encrypted_database" as const,
            envelope: Object.freeze({
              materialCiphertextBase64: encryptedMaterial.ciphertextBase64,
              materialNonceBase64: materialNonce.toString("base64"),
              materialAuthTagBase64: encryptedMaterial.authTagBase64,
              wrappedDekBase64: wrappedDek.ciphertextBase64,
              wrapNonceBase64: wrapNonce.toString("base64"),
              wrapAuthTagBase64: wrappedDek.authTagBase64,
              kekVersion: activeKekVersion,
            }),
          }),
        });
      } finally {
        plaintext.fill(0);
        dek.fill(0);
        materialNonce.fill(0);
        wrapNonce.fill(0);
        materialAad.fill(0);
        wrapAad.fill(0);
        kek?.fill(0);
      }
    },
  });
}
