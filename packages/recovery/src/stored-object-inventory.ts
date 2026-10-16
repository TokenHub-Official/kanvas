import { createHash } from "node:crypto";

import type { StorageObjectIdentity, StoragePort } from "@kanvas/application";
import type { Pool, RowDataPacket } from "mysql2/promise";

import { canonicalizeBackupValue } from "./backup-set-manifest.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const identityDigestPattern = /^sha256:[0-9a-f]{64}$/u;
const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;

export interface StoredObjectReferenceFact {
  readonly id: string;
  readonly workspaceId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId?: string;
  readonly immutableIdentityHash: string;
  readonly byteSize: string;
  readonly sha256: string;
  readonly deleteState: "active" | "deletion_pending";
}

export interface StoredObjectInventoryEvidence {
  readonly schemaVersion: 1;
  readonly inventoryDigest: string;
  readonly storedObjectReferenceCount: string;
  readonly verifiedObjectCount: string;
}

export interface VerifyStoredObjectInventoryOptions {
  readonly pool: Pool;
  readonly storage: StoragePort;
  readonly batchSize?: number;
  readonly verificationConcurrency?: number;
}

export type StoredObjectInventoryErrorCode =
  | "recovery_inventory.invalid_argument"
  | "recovery_inventory.invalid_database_fact"
  | "recovery_inventory.profile_mismatch"
  | "recovery_inventory.object_missing"
  | "recovery_inventory.object_identity_mismatch"
  | "recovery_inventory.storage_failure";

export class StoredObjectInventoryError extends Error {
  constructor(
    readonly code: StoredObjectInventoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StoredObjectInventoryError";
  }
}

interface StoredObjectRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId: string | null;
  readonly immutableIdentityHash: string | null;
  readonly byteSize: string;
  readonly sha256: string;
  readonly deleteState: "active" | "deletion_pending";
}

function fail(
  code: StoredObjectInventoryErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new StoredObjectInventoryError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    return fail(
      "recovery_inventory.invalid_argument",
      `${label} is outside its bounded range.`,
    );
  }
  return result;
}

function boundedText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}

function factFrom(row: StoredObjectRow): StoredObjectReferenceFact {
  if (
    !idPattern.test(row.id) ||
    !idPattern.test(row.workspaceId) ||
    !idPattern.test(row.storageProfileId) ||
    !boundedText(row.container, 160) ||
    !boundedText(row.objectKey, 800) ||
    (row.storageVersionId !== null &&
      !boundedText(row.storageVersionId, 240)) ||
    row.immutableIdentityHash === null ||
    !identityDigestPattern.test(row.immutableIdentityHash) ||
    !uint64Pattern.test(row.byteSize) ||
    !sha256Pattern.test(row.sha256) ||
    !["active", "deletion_pending"].includes(row.deleteState)
  ) {
    return fail(
      "recovery_inventory.invalid_database_fact",
      "StoredObject contains an invalid recovery identity fact.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    storageProfileId: row.storageProfileId,
    container: row.container,
    objectKey: row.objectKey,
    ...(row.storageVersionId ? { storageVersionId: row.storageVersionId } : {}),
    immutableIdentityHash: row.immutableIdentityHash,
    byteSize: row.byteSize,
    sha256: row.sha256,
    deleteState: row.deleteState,
  });
}

function identityFor(fact: StoredObjectReferenceFact): StorageObjectIdentity {
  return Object.freeze({
    storageProfileId: fact.storageProfileId,
    container: fact.container,
    objectKey: fact.objectKey,
    ...(fact.storageVersionId
      ? { storageVersionId: fact.storageVersionId }
      : {}),
  });
}

async function verifyOne(
  storage: StoragePort,
  fact: StoredObjectReferenceFact,
): Promise<void> {
  if (fact.storageProfileId !== storage.storageProfileId) {
    return fail(
      "recovery_inventory.profile_mismatch",
      "StoredObject references a different storage profile.",
    );
  }
  let inspection;
  try {
    inspection = await storage.inspectObject(identityFor(fact));
  } catch (error) {
    if (error instanceof StoredObjectInventoryError) {
      throw error;
    }
    return fail(
      "recovery_inventory.storage_failure",
      "StoredObject could not be verified through its storage profile.",
      error,
    );
  }
  if (!inspection) {
    return fail(
      "recovery_inventory.object_missing",
      "A referenced StoredObject is missing.",
    );
  }
  if (
    inspection.byteSize !== fact.byteSize ||
    inspection.sha256 !== fact.sha256 ||
    inspection.immutableIdentityHash !== fact.immutableIdentityHash ||
    inspection.identity.storageProfileId !== fact.storageProfileId ||
    inspection.identity.container !== fact.container ||
    inspection.identity.objectKey !== fact.objectKey ||
    inspection.identity.storageVersionId !== fact.storageVersionId
  ) {
    return fail(
      "recovery_inventory.object_identity_mismatch",
      "A referenced StoredObject does not match its committed identity.",
    );
  }
}

async function verifyBatch(
  storage: StoragePort,
  facts: readonly StoredObjectReferenceFact[],
  concurrency: number,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < facts.length) {
      const index = next;
      next += 1;
      await verifyOne(storage, facts[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, facts.length) }, () => worker()),
  );
}

export async function verifyStoredObjectInventory(
  options: VerifyStoredObjectInventoryOptions,
): Promise<StoredObjectInventoryEvidence> {
  const batchSize = boundedInteger(
    options.batchSize,
    100,
    1,
    1_000,
    "batchSize",
  );
  const verificationConcurrency = boundedInteger(
    options.verificationConcurrency,
    4,
    1,
    32,
    "verificationConcurrency",
  );
  const hash = createHash("sha256");
  hash.update("kanvas:stored-object-reference-inventory:v1\0", "utf8");
  hash.update('{"objects":[', "utf8");
  let cursor = "";
  let count = 0n;
  let first = true;

  while (true) {
    const [rows] = await options.pool.query<StoredObjectRow[]>(
      `SELECT
         id,
         workspace_id AS workspaceId,
         storage_profile_id AS storageProfileId,
         container,
         object_key AS objectKey,
         storage_version_id AS storageVersionId,
         immutable_identity_hash AS immutableIdentityHash,
         CAST(byte_size AS CHAR) AS byteSize,
         sha256,
         delete_state AS deleteState
       FROM stored_object
       WHERE delete_state IN ('active', 'deletion_pending')
         AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [cursor, batchSize],
    );
    if (rows.length === 0) {
      break;
    }
    const facts = rows.map(factFrom);
    for (const fact of facts) {
      if (!first) {
        hash.update(",", "utf8");
      }
      hash.update(canonicalizeBackupValue(fact), "utf8");
      first = false;
      count += 1n;
    }
    await verifyBatch(options.storage, facts, verificationConcurrency);
    cursor = facts[facts.length - 1]!.id;
    if (rows.length < batchSize) {
      break;
    }
  }

  hash.update("]}", "utf8");
  const renderedCount = count.toString();
  return Object.freeze({
    schemaVersion: 1,
    inventoryDigest: `sha256:${hash.digest("hex")}`,
    storedObjectReferenceCount: renderedCount,
    verifiedObjectCount: renderedCount,
  });
}
