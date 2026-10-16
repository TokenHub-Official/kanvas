import { createHash } from "node:crypto";

import type { SecretVersionLifecycle } from "@kanvas/database/runtime";
import type { Pool, RowDataPacket } from "mysql2/promise";

import {
  canonicalizeBackupValue,
  digestBackupValue,
  type BackupSetManifestV1,
} from "./backup-set-manifest.js";
import { failRecoveryVerification } from "./recovery-verification-error.js";

interface SecretVersionRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly version: number;
  readonly materialGeneration: number;
  readonly sourceKind: string;
  readonly lifecycleStatus: SecretVersionLifecycle;
  readonly materialCiphertextBase64: string | null;
  readonly materialNonceBase64: string | null;
  readonly materialAuthTagBase64: string | null;
  readonly wrappedDekBase64: string | null;
  readonly wrapNonceBase64: string | null;
  readonly wrapAuthTagBase64: string | null;
  readonly kekVersion: string | null;
  readonly aadDigest: string;
  readonly deploymentReference: string | null;
  readonly materialFingerprint: string;
  readonly formatVersion: number;
  readonly drainDeadlineAt: Date | null;
}

interface SecretRecoveryFactBase {
  readonly id: string;
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly version: number;
  readonly materialGeneration: number;
  readonly lifecycleStatus: SecretVersionLifecycle;
  readonly aadDigest: string;
  readonly materialFingerprint: string;
  readonly formatVersion: number;
  readonly drainDeadlineAt: Date | null;
}

export interface EncryptedSecretRecoveryFact extends SecretRecoveryFactBase {
  readonly sourceKind: "encrypted_database";
  readonly materialCiphertextBase64: string;
  readonly materialNonceBase64: string;
  readonly materialAuthTagBase64: string;
  readonly wrappedDekBase64: string;
  readonly wrapNonceBase64: string;
  readonly wrapAuthTagBase64: string;
  readonly kekVersion: string;
}

export interface DeploymentSecretRecoveryFact extends SecretRecoveryFactBase {
  readonly sourceKind: "deployment_reference";
  readonly deploymentReference: string;
}

export interface SecretRecoveryEvidence {
  readonly encryptedSecretVersionCount: string;
  readonly deploymentSecretReferenceCount: string;
  readonly kekVersions: readonly string[];
  readonly secretReferenceInventoryDigest: string;
}

export interface SecretRecoveryVerificationPorts {
  readonly verifyEncryptedSecret?: (
    fact: EncryptedSecretRecoveryFact,
  ) => Promise<void>;
  readonly verifyDeploymentSecretReference?: (
    fact: DeploymentSecretRecoveryFact,
  ) => Promise<void>;
}

function completeEncryptedFact(
  row: SecretVersionRow,
): EncryptedSecretRecoveryFact {
  if (
    row.sourceKind !== "encrypted_database" ||
    row.materialCiphertextBase64 === null ||
    row.materialNonceBase64 === null ||
    row.materialAuthTagBase64 === null ||
    row.wrappedDekBase64 === null ||
    row.wrapNonceBase64 === null ||
    row.wrapAuthTagBase64 === null ||
    row.kekVersion === null ||
    row.deploymentReference !== null
  ) {
    return failRecoveryVerification(
      "recovery_verification.secret_reference_mismatch",
      "Encrypted SecretVersion recovery facts are incomplete.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    credentialId: row.credentialId,
    version: row.version,
    materialGeneration: row.materialGeneration,
    sourceKind: "encrypted_database",
    lifecycleStatus: row.lifecycleStatus,
    materialCiphertextBase64: row.materialCiphertextBase64,
    materialNonceBase64: row.materialNonceBase64,
    materialAuthTagBase64: row.materialAuthTagBase64,
    wrappedDekBase64: row.wrappedDekBase64,
    wrapNonceBase64: row.wrapNonceBase64,
    wrapAuthTagBase64: row.wrapAuthTagBase64,
    kekVersion: row.kekVersion,
    aadDigest: row.aadDigest,
    materialFingerprint: row.materialFingerprint,
    formatVersion: row.formatVersion,
    drainDeadlineAt: row.drainDeadlineAt,
  });
}

function completeDeploymentFact(
  row: SecretVersionRow,
): DeploymentSecretRecoveryFact {
  if (
    row.sourceKind !== "deployment_reference" ||
    row.deploymentReference === null ||
    row.materialCiphertextBase64 !== null ||
    row.materialNonceBase64 !== null ||
    row.materialAuthTagBase64 !== null ||
    row.wrappedDekBase64 !== null ||
    row.wrapNonceBase64 !== null ||
    row.wrapAuthTagBase64 !== null ||
    row.kekVersion !== null
  ) {
    return failRecoveryVerification(
      "recovery_verification.secret_reference_mismatch",
      "Deployment SecretVersion recovery facts are incomplete.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    credentialId: row.credentialId,
    version: row.version,
    materialGeneration: row.materialGeneration,
    sourceKind: "deployment_reference",
    lifecycleStatus: row.lifecycleStatus,
    deploymentReference: row.deploymentReference,
    aadDigest: row.aadDigest,
    materialFingerprint: row.materialFingerprint,
    formatVersion: row.formatVersion,
    drainDeadlineAt: row.drainDeadlineAt,
  });
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function collectSecretRecoveryEvidence(
  options: {
    readonly pool: Pool;
    readonly batchSize?: number;
  } & SecretRecoveryVerificationPorts,
): Promise<SecretRecoveryEvidence> {
  const batchSize = options.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    return failRecoveryVerification(
      "recovery_verification.invalid_argument",
      "Secret verification batch size is outside its bounded range.",
    );
  }

  const hash = createHash("sha256");
  hash.update("kanvas:secret-reference-inventory:v1\0", "utf8");
  hash.update('{"secretVersions":[', "utf8");
  const kekVersions = new Set<string>();
  let encryptedCount = 0n;
  let deploymentReferenceCount = 0n;
  let cursor = "";
  let first = true;

  while (true) {
    let rows: readonly SecretVersionRow[];
    try {
      [rows] = await options.pool.query<SecretVersionRow[]>(
        `SELECT
           id,
           workspace_id AS workspaceId,
           credential_id AS credentialId,
           version,
           material_generation AS materialGeneration,
           source_kind AS sourceKind,
           lifecycle_status AS lifecycleStatus,
           material_ciphertext_base64 AS materialCiphertextBase64,
           material_nonce_base64 AS materialNonceBase64,
           material_auth_tag_base64 AS materialAuthTagBase64,
           wrapped_dek_base64 AS wrappedDekBase64,
           wrap_nonce_base64 AS wrapNonceBase64,
           wrap_auth_tag_base64 AS wrapAuthTagBase64,
           kek_version AS kekVersion,
           aad_digest AS aadDigest,
           deployment_reference AS deploymentReference,
           material_fingerprint AS materialFingerprint,
           format_version AS formatVersion,
           drain_deadline_at AS drainDeadlineAt
         FROM secret_version
         WHERE lifecycle_status <> 'destroyed'
           AND id > ?
         ORDER BY id ASC
         LIMIT ?`,
        [cursor, batchSize],
      );
    } catch (error) {
      return failRecoveryVerification(
        "recovery_verification.database_failure",
        "SecretVersion recovery facts could not be read.",
        error,
      );
    }
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      let inventoryFact: Readonly<Record<string, string | number>> | undefined;
      if (row.sourceKind === "encrypted_database") {
        const fact = completeEncryptedFact(row);
        if (!options.verifyEncryptedSecret) {
          return failRecoveryVerification(
            "recovery_verification.secret_unverifiable",
            "Encrypted SecretVersions require a recovery KEK verifier.",
          );
        }
        try {
          await options.verifyEncryptedSecret(fact);
        } catch (error) {
          return failRecoveryVerification(
            "recovery_verification.secret_unverifiable",
            "An encrypted SecretVersion could not be recovered.",
            error,
          );
        }
        kekVersions.add(fact.kekVersion);
        encryptedCount += 1n;
        inventoryFact = Object.freeze({
          id: fact.id,
          sourceKind: fact.sourceKind,
          materialFingerprint: fact.materialFingerprint,
          kekVersion: fact.kekVersion,
        });
      } else if (row.sourceKind === "deployment_reference") {
        const fact = completeDeploymentFact(row);
        if (!options.verifyDeploymentSecretReference) {
          return failRecoveryVerification(
            "recovery_verification.secret_unverifiable",
            "Deployment SecretVersions require a reference resolver.",
          );
        }
        try {
          await options.verifyDeploymentSecretReference(fact);
        } catch (error) {
          return failRecoveryVerification(
            "recovery_verification.secret_unverifiable",
            "A deployment SecretVersion reference could not be resolved.",
            error,
          );
        }
        deploymentReferenceCount += 1n;
        inventoryFact = Object.freeze({
          id: fact.id,
          sourceKind: fact.sourceKind,
          materialFingerprint: fact.materialFingerprint,
          deploymentReferenceDigest: digestBackupValue(
            "kanvas:deployment-secret-reference:v1",
            fact.deploymentReference,
          ),
        });
      } else {
        return failRecoveryVerification(
          "recovery_verification.secret_reference_mismatch",
          "SecretVersion uses an unsupported recovery source.",
        );
      }
      if (!first) {
        hash.update(",", "utf8");
      }
      hash.update(canonicalizeBackupValue(inventoryFact), "utf8");
      first = false;
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < batchSize) {
      break;
    }
  }

  const sortedKekVersions = Object.freeze([...kekVersions].sort());
  hash.update("]}", "utf8");
  return Object.freeze({
    encryptedSecretVersionCount: encryptedCount.toString(),
    deploymentSecretReferenceCount: deploymentReferenceCount.toString(),
    kekVersions: sortedKekVersions,
    secretReferenceInventoryDigest: `sha256:${hash.digest("hex")}`,
  });
}

export async function verifySecretRecoveryEvidence(
  options: {
    readonly pool: Pool;
    readonly manifest: BackupSetManifestV1;
    readonly batchSize?: number;
  } & SecretRecoveryVerificationPorts,
): Promise<SecretRecoveryEvidence> {
  const evidence = await collectSecretRecoveryEvidence({
    pool: options.pool,
    ...(options.batchSize === undefined
      ? {}
      : { batchSize: options.batchSize }),
    ...(options.verifyEncryptedSecret
      ? {
          verifyEncryptedSecret: options.verifyEncryptedSecret,
        }
      : {}),
    ...(options.verifyDeploymentSecretReference
      ? {
          verifyDeploymentSecretReference:
            options.verifyDeploymentSecretReference,
        }
      : {}),
  });
  if (
    !arraysEqual(
      evidence.kekVersions,
      options.manifest.keyReferences.kekVersions,
    ) ||
    evidence.deploymentSecretReferenceCount !==
      options.manifest.keyReferences.deploymentSecretReferenceCount
  ) {
    return failRecoveryVerification(
      "recovery_verification.secret_reference_mismatch",
      "Restored secret authority references do not match the BackupSet.",
    );
  }
  return evidence;
}
