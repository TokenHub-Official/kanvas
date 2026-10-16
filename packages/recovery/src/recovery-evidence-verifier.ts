import type { StoragePort } from "@kanvas/application";
import type { RecoveryVerificationSummary } from "@kanvas/database";
import type { Pool, RowDataPacket } from "mysql2/promise";

import {
  parseBackupSetEnvelope,
  digestBackupValue,
  type BackupMigrationEntry,
  type BackupSetEnvelopeV1,
  type BackupSetManifestV1,
} from "./backup-set-manifest.js";
import {
  verifyAuditRecoveryEvidence,
  type AuditRecoveryEvidence,
} from "./audit-integrity-evidence.js";
import {
  verifyMigrationRecoveryEvidence,
  type MigrationRecoveryEvidence,
} from "./migration-evidence.js";
import {
  failRecoveryVerification,
  RecoveryVerificationError,
} from "./recovery-verification-error.js";
import {
  verifySecretRecoveryEvidence,
  type SecretRecoveryEvidence,
  type SecretRecoveryVerificationPorts,
} from "./secret-recovery-evidence.js";
import {
  StoredObjectInventoryError,
  verifyStoredObjectInventory,
  type StoredObjectInventoryEvidence,
} from "./stored-object-inventory.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const maximumUint32 = 4_294_967_295;

interface RuntimeRecoveryRow extends RowDataPacket {
  readonly runtimeState: string;
  readonly executionGeneration: number;
  readonly stateVersion: number;
  readonly recoveryOperationId: string;
  readonly backupSetId: string;
  readonly manifestDigest: string;
  readonly lifecycleStatus: string;
  readonly fencedExecutionGeneration: number;
  readonly beginStateVersion: number;
}

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

interface RecoveryInvariantDefinition {
  readonly key: string;
  readonly sql: string;
}

export interface RecoveryInvariantEvidence {
  readonly key: string;
  readonly violationCount: string;
}

export interface RecoveryVerificationEvidenceV1 {
  readonly schemaVersion: 1;
  readonly backupSetId: string;
  readonly manifestDigest: string;
  readonly deploymentId: string;
  readonly recoveryOperationId: string;
  readonly executionGeneration: number;
  readonly configurationManifestDigest: string;
  readonly imageDigests: BackupSetManifestV1["images"];
  readonly migration: MigrationRecoveryEvidence;
  readonly objects: StoredObjectInventoryEvidence;
  readonly secrets: SecretRecoveryEvidence;
  readonly audit: AuditRecoveryEvidence;
  readonly invariants: readonly RecoveryInvariantEvidence[];
  readonly pendingOutboxCount: string;
  readonly unknownProviderInvocationCount: string;
  readonly unknownBudgetReservationCount: string;
}

export interface RecoveryVerificationResult {
  readonly evidence: RecoveryVerificationEvidenceV1;
  readonly summary: RecoveryVerificationSummary;
  readonly verificationResultDigest: string;
}

export interface VerifyRecoveryEvidenceOptions extends SecretRecoveryVerificationPorts {
  readonly pool: Pool;
  readonly storage: StoragePort;
  readonly backupSet: unknown;
  readonly expectedMigrations: readonly BackupMigrationEntry[];
  readonly deploymentId: string;
  readonly configManifestDigest: string;
  readonly imageDigests: BackupSetManifestV1["images"];
  readonly instanceId: string;
  readonly recoveryOperationId: string;
  readonly expectedExecutionGeneration: number;
  readonly databaseBatchSize?: number;
  readonly verificationConcurrency?: number;
}

const invariantDefinitions: readonly RecoveryInvariantDefinition[] =
  Object.freeze([
    Object.freeze({
      key: "capability_run.current_attempt_scope",
      sql: `SELECT COUNT(*) AS count
            FROM capability_run AS run
            LEFT JOIN capability_attempt AS attempt
              ON attempt.id = run.current_attempt_id
            WHERE run.current_attempt_id IS NOT NULL
              AND (
                attempt.id IS NULL
                OR attempt.workspace_id <> run.workspace_id
                OR attempt.capability_run_id <> run.id
              )`,
    }),
    Object.freeze({
      key: "capability_run.accepted_attempt_scope",
      sql: `SELECT COUNT(*) AS count
            FROM capability_run AS run
            LEFT JOIN capability_attempt AS attempt
              ON attempt.id = run.accepted_attempt_id
            WHERE run.accepted_attempt_id IS NOT NULL
              AND (
                attempt.id IS NULL
                OR attempt.workspace_id <> run.workspace_id
                OR attempt.capability_run_id <> run.id
                OR attempt.lifecycle_status <> 'completed'
              )`,
    }),
    Object.freeze({
      key: "capability_run.completed_state",
      sql: `SELECT COUNT(*) AS count
            FROM capability_run AS run
            WHERE run.lifecycle_status = 'completed'
              AND (
                run.accepted_attempt_id IS NULL
                OR run.completed_at IS NULL
              )`,
    }),
    Object.freeze({
      key: "artifact.available_storage",
      sql: `SELECT COUNT(*) AS count
            FROM artifact
            LEFT JOIN stored_object
              ON stored_object.id = artifact.stored_object_id
            WHERE artifact.availability_status = 'available'
              AND artifact.stored_object_id IS NOT NULL
              AND (
                stored_object.id IS NULL
                OR stored_object.workspace_id
                     <> artifact.workspace_id
                OR stored_object.delete_state NOT IN (
                  'active',
                  'deletion_pending'
                )
              )`,
    }),
    Object.freeze({
      key: "artifact.binary_content_digest",
      sql: `SELECT COUNT(*) AS count
            FROM artifact
            INNER JOIN stored_object
              ON stored_object.id = artifact.stored_object_id
            WHERE artifact.stored_object_id IS NOT NULL
              AND artifact.content_digest
                    <> CONCAT('sha256:', stored_object.sha256)`,
    }),
    Object.freeze({
      key: "attempt_output.available_artifact",
      sql: `SELECT COUNT(*) AS count
            FROM attempt_output AS output
            LEFT JOIN capability_attempt AS attempt
              ON attempt.id = output.capability_attempt_id
            LEFT JOIN artifact
              ON artifact.id = output.artifact_id
            WHERE attempt.id IS NULL
               OR artifact.id IS NULL
               OR attempt.workspace_id <> output.workspace_id
               OR artifact.workspace_id <> output.workspace_id
               OR artifact.availability_status <> 'available'`,
    }),
    Object.freeze({
      key: "attempt_completion.lifecycle",
      sql: `SELECT COUNT(*) AS count
            FROM attempt_completion AS completion
            LEFT JOIN capability_attempt AS attempt
              ON attempt.id = completion.capability_attempt_id
            LEFT JOIN capability_run AS run
              ON run.id = completion.capability_run_id
            LEFT JOIN outbox_event AS outbox
              ON outbox.id = completion.terminal_outbox_event_id
            WHERE attempt.id IS NULL
               OR run.id IS NULL
               OR outbox.id IS NULL
               OR attempt.workspace_id <> completion.workspace_id
               OR run.workspace_id <> completion.workspace_id
               OR outbox.workspace_id <> completion.workspace_id
               OR attempt.capability_run_id <> run.id
               OR attempt.lifecycle_status <> 'completed'
               OR run.lifecycle_status <> 'completed'
               OR run.accepted_attempt_id <> attempt.id
               OR attempt.completion_manifest_hash
                    <> completion.completion_manifest_hash`,
    }),
    Object.freeze({
      key: "attempt_completion.output_count",
      sql: `SELECT COUNT(*) AS count
            FROM attempt_completion AS completion
            WHERE completion.output_count <> (
              SELECT COUNT(*)
              FROM attempt_output AS output
              WHERE output.capability_attempt_id =
                    completion.capability_attempt_id
            )`,
    }),
    Object.freeze({
      key: "attempt_completion.usage_count",
      sql: `SELECT COUNT(*) AS count
            FROM attempt_completion AS completion
            WHERE completion.initial_usage_entry_count <> (
              SELECT COUNT(*)
              FROM usage_ledger_entry AS usage_entry
              WHERE usage_entry.attempt_completion_id =
                    completion.id
                AND usage_entry.recording_phase = 'completion'
            )`,
    }),
    Object.freeze({
      key: "asset.current_artifact_available",
      sql: `SELECT COUNT(*) AS count
            FROM asset
            LEFT JOIN artifact
              ON artifact.id = asset.current_artifact_id
            WHERE asset.current_artifact_id IS NOT NULL
              AND (
                artifact.id IS NULL
                OR artifact.workspace_id <> asset.workspace_id
                OR artifact.asset_id <> asset.id
                OR artifact.availability_status <> 'available'
              )`,
    }),
    Object.freeze({
      key: "upload.committed_object_scope",
      sql: `SELECT COUNT(*) AS count
            FROM upload_session AS upload
            LEFT JOIN stored_object
              ON stored_object.id =
                 upload.committed_stored_object_id
            WHERE upload.state = 'committed'
              AND (
                stored_object.id IS NULL
                OR stored_object.workspace_id <> upload.workspace_id
                OR stored_object.created_from_upload_session_id
                     <> upload.id
              )`,
    }),
  ]);

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    failRecoveryVerification(
      "recovery_verification.invalid_argument",
      `${label} must be a canonical uppercase ULID.`,
    );
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    failRecoveryVerification(
      "recovery_verification.invalid_argument",
      `${label} must be a canonical SHA-256 digest.`,
    );
  }
}

function assertGeneration(value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximumUint32
  ) {
    failRecoveryVerification(
      "recovery_verification.invalid_argument",
      "expectedExecutionGeneration is invalid.",
    );
  }
}

function boundedDeploymentId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 240 ||
    value !== value.trim() ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    failRecoveryVerification(
      "recovery_verification.invalid_argument",
      "deploymentId is invalid.",
    );
  }
}

function imagesEqual(
  left: BackupSetManifestV1["images"],
  right: BackupSetManifestV1["images"],
): boolean {
  return (
    left.app === right.app &&
    left.web === right.web &&
    left.mysql === right.mysql &&
    left.redis === right.redis
  );
}

function decimalCount(value: number | string | undefined): string {
  const rendered = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]{0,19})$/u.test(rendered)) {
    return failRecoveryVerification(
      "recovery_verification.database_failure",
      "Database returned an invalid count fact.",
    );
  }
  return rendered;
}

async function countQuery(
  pool: Pool,
  sql: string,
  values: (string | number | null)[] = [],
): Promise<string> {
  try {
    const [rows] = await pool.query<CountRow[]>(sql, values);
    return decimalCount(rows[0]?.count);
  } catch (error) {
    return failRecoveryVerification(
      "recovery_verification.database_failure",
      "A recovery verification count query failed.",
      error,
    );
  }
}

async function verifyRuntimeAndOperation(options: {
  readonly pool: Pool;
  readonly instanceId: string;
  readonly recoveryOperationId: string;
  readonly expectedExecutionGeneration: number;
  readonly backupSet: BackupSetEnvelopeV1;
}): Promise<void> {
  let rows: readonly RuntimeRecoveryRow[];
  try {
    [rows] = await options.pool.query<RuntimeRecoveryRow[]>(
      `SELECT
         runtime.state AS runtimeState,
         runtime.execution_generation AS executionGeneration,
         runtime.state_version AS stateVersion,
         operation.id AS recoveryOperationId,
         operation.backup_set_id AS backupSetId,
         operation.manifest_digest AS manifestDigest,
         operation.lifecycle_status AS lifecycleStatus,
         operation.fenced_execution_generation
           AS fencedExecutionGeneration,
         operation.begin_state_version AS beginStateVersion
       FROM instance_runtime_state AS runtime
       INNER JOIN recovery_operation AS operation
         ON operation.instance_id = runtime.instance_id
       WHERE runtime.instance_id = ?
         AND operation.id = ?`,
      [options.instanceId, options.recoveryOperationId],
    );
  } catch (error) {
    return failRecoveryVerification(
      "recovery_verification.database_failure",
      "Recovery runtime evidence could not be read.",
      error,
    );
  }
  const row = rows[0];
  const manifestRuntime = options.backupSet.manifest.runtime;
  if (
    !row ||
    rows.length !== 1 ||
    row.recoveryOperationId !== options.recoveryOperationId ||
    row.backupSetId !== options.backupSet.manifest.backupSetId ||
    row.manifestDigest !== options.backupSet.manifestDigest ||
    row.lifecycleStatus !== "verifying"
  ) {
    return failRecoveryVerification(
      "recovery_verification.operation_mismatch",
      "Recovery operation does not match the selected BackupSet.",
    );
  }
  if (
    manifestRuntime.executionGeneration >= maximumUint32 ||
    manifestRuntime.stateVersion >= maximumUint32 - 1 ||
    options.expectedExecutionGeneration !==
      manifestRuntime.executionGeneration + 1 ||
    row.runtimeState !== "VERIFYING" ||
    row.executionGeneration !== options.expectedExecutionGeneration ||
    row.fencedExecutionGeneration !== options.expectedExecutionGeneration ||
    row.beginStateVersion !== manifestRuntime.stateVersion + 1 ||
    row.stateVersion !== manifestRuntime.stateVersion + 2
  ) {
    return failRecoveryVerification(
      "recovery_verification.runtime_mismatch",
      "Recovery runtime generation is not derived from the BackupSet fence.",
    );
  }
  const competing = await countQuery(
    options.pool,
    `SELECT COUNT(*) AS count
     FROM recovery_operation
     WHERE instance_id = ?
       AND id <> ?
       AND lifecycle_status IN (
         'restoring',
         'verifying',
         'read_only'
       )`,
    [options.instanceId, options.recoveryOperationId],
  );
  if (competing !== "0") {
    return failRecoveryVerification(
      "recovery_verification.operation_mismatch",
      "Another recovery operation is concurrently active.",
    );
  }
}

async function verifyInvariants(
  pool: Pool,
): Promise<readonly RecoveryInvariantEvidence[]> {
  const evidence = await Promise.all(
    invariantDefinitions.map(async ({ key, sql }) =>
      Object.freeze({
        key,
        violationCount: await countQuery(pool, sql),
      }),
    ),
  );
  if (evidence.some((item) => item.violationCount !== "0")) {
    return failRecoveryVerification(
      "recovery_verification.invariant_violation",
      "Restored database violates one or more recovery invariants.",
    );
  }
  return Object.freeze(evidence);
}

export async function verifyRecoveryEvidence(
  options: VerifyRecoveryEvidenceOptions,
): Promise<RecoveryVerificationResult> {
  assertId(options.recoveryOperationId, "recoveryOperationId");
  assertGeneration(options.expectedExecutionGeneration);
  assertDigest(options.configManifestDigest, "configManifestDigest");
  boundedDeploymentId(options.deploymentId);

  const backupSet = parseBackupSetEnvelope(options.backupSet);
  const manifest = backupSet.manifest;
  if (manifest.deploymentId !== options.deploymentId) {
    return failRecoveryVerification(
      "recovery_verification.deployment_mismatch",
      "BackupSet belongs to a different deployment.",
    );
  }
  if (
    manifest.configuration.configManifestDigest !==
      options.configManifestDigest ||
    !imagesEqual(manifest.images, options.imageDigests)
  ) {
    return failRecoveryVerification(
      "recovery_verification.configuration_mismatch",
      "Recovery configuration or image digests do not match the BackupSet.",
    );
  }
  if (
    options.storage.storageProfileId !== manifest.objects.storageProfileId ||
    options.storage.kind !== manifest.objects.storageKind
  ) {
    return failRecoveryVerification(
      "recovery_verification.object_mismatch",
      "Recovery storage profile does not match the BackupSet.",
    );
  }

  await verifyRuntimeAndOperation({
    pool: options.pool,
    instanceId: options.instanceId,
    recoveryOperationId: options.recoveryOperationId,
    expectedExecutionGeneration: options.expectedExecutionGeneration,
    backupSet,
  });

  let objects: StoredObjectInventoryEvidence;
  try {
    objects = await verifyStoredObjectInventory({
      pool: options.pool,
      storage: options.storage,
      ...(options.databaseBatchSize === undefined
        ? {}
        : { batchSize: options.databaseBatchSize }),
      ...(options.verificationConcurrency === undefined
        ? {}
        : {
            verificationConcurrency: options.verificationConcurrency,
          }),
    });
  } catch (error) {
    if (error instanceof StoredObjectInventoryError) {
      return failRecoveryVerification(
        "recovery_verification.object_mismatch",
        "Restored object inventory could not be verified.",
        error,
      );
    }
    throw error;
  }
  if (
    objects.inventoryDigest !== manifest.objects.inventoryDigest ||
    objects.storedObjectReferenceCount !==
      manifest.objects.storedObjectReferenceCount ||
    objects.verifiedObjectCount !== manifest.objects.storedObjectReferenceCount
  ) {
    return failRecoveryVerification(
      "recovery_verification.object_mismatch",
      "Restored object inventory does not match the BackupSet.",
    );
  }

  const [
    migration,
    secrets,
    audit,
    invariants,
    pendingOutboxCount,
    unknownProviderInvocationCount,
    unknownBudgetReservationCount,
  ] = await Promise.all([
    verifyMigrationRecoveryEvidence({
      pool: options.pool,
      manifest,
      expectedMigrations: options.expectedMigrations,
    }),
    verifySecretRecoveryEvidence({
      pool: options.pool,
      manifest,
      ...(options.databaseBatchSize === undefined
        ? {}
        : { batchSize: options.databaseBatchSize }),
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
    }),
    verifyAuditRecoveryEvidence({
      pool: options.pool,
      ...(options.databaseBatchSize === undefined
        ? {}
        : { batchSize: options.databaseBatchSize }),
    }),
    verifyInvariants(options.pool),
    countQuery(
      options.pool,
      `SELECT COUNT(*) AS count
       FROM outbox_event
       WHERE status IN ('pending', 'leased')`,
    ),
    countQuery(
      options.pool,
      `SELECT COUNT(*) AS count
       FROM provider_invocation
       WHERE remote_status = 'unknown'`,
    ),
    countQuery(
      options.pool,
      `SELECT COUNT(*) AS count
       FROM budget_reservation
       WHERE lifecycle_status = 'unknown'`,
    ),
  ]);

  const evidence: RecoveryVerificationEvidenceV1 = Object.freeze({
    schemaVersion: 1,
    backupSetId: manifest.backupSetId,
    manifestDigest: backupSet.manifestDigest,
    deploymentId: options.deploymentId,
    recoveryOperationId: options.recoveryOperationId,
    executionGeneration: options.expectedExecutionGeneration,
    configurationManifestDigest: options.configManifestDigest,
    imageDigests: manifest.images,
    migration,
    objects,
    secrets,
    audit,
    invariants,
    pendingOutboxCount,
    unknownProviderInvocationCount,
    unknownBudgetReservationCount,
  });
  const summary: RecoveryVerificationSummary = Object.freeze({
    schemaMigrationCount: migration.schemaMigrationCount,
    storedObjectReferenceCount: objects.storedObjectReferenceCount,
    verifiedObjectCount: objects.verifiedObjectCount,
    invariantCheckCount: invariants.length,
    pendingOutboxCount,
    unknownBudgetReservationCount,
    auditEventCount: audit.auditEventCount,
  });
  return Object.freeze({
    evidence,
    summary,
    verificationResultDigest: digestBackupValue(
      "kanvas:recovery-verification-result:v1",
      evidence,
    ),
  });
}

export function recoveryVerificationFailureCode(error: unknown): string {
  return error instanceof RecoveryVerificationError
    ? error.code
    : "recovery_verification.unexpected_failure";
}
