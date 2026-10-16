import { authorizationModelVersion } from "@kanvas/application";
import type { InstanceRuntimeState } from "@kanvas/contracts/primitives";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "./audit-event-store.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const reasonCodePattern = /^[a-z0-9](?:[a-z0-9._-]{0,118}[a-z0-9])?$/u;
const maximumUint32 = 4_294_967_295;

export type RecoveryOperationLifecycleStatus =
  "restoring" | "verifying" | "read_only" | "active" | "aborted";

export interface RecoveryVerificationSummary {
  readonly schemaMigrationCount: number;
  readonly storedObjectReferenceCount: string;
  readonly verifiedObjectCount: string;
  readonly invariantCheckCount: number;
  readonly pendingOutboxCount: string;
  readonly unknownBudgetReservationCount: string;
  readonly auditEventCount: string;
}

export interface RecoveryCommandAuditContext {
  readonly auditEventId: string;
  readonly authenticationRefHash: string;
}

export interface RecoveryOperationRecord {
  readonly id: string;
  readonly instanceId: string;
  readonly backupSetId: string;
  readonly manifestDigest: string;
  readonly lifecycleStatus: RecoveryOperationLifecycleStatus;
  readonly fencedExecutionGeneration: number;
  readonly beginStateVersion: number;
  readonly verificationResultDigest?: string;
  readonly verificationSummary?: RecoveryVerificationSummary;
  readonly activationAckDigest?: string;
  readonly lastFailureCode?: string;
  readonly version: number;
  readonly startedAt: Date;
  readonly verificationStartedAt?: Date;
  readonly verifiedAt?: Date;
  readonly activatedAt?: Date;
  readonly abortedAt?: Date;
  readonly updatedAt: Date;
}

export interface RecoveryOperationResult extends RecoveryOperationRecord {
  readonly replayed: boolean;
}

export interface BeginRecoveryOptions extends RecoveryCommandAuditContext {
  readonly recoveryOperationId: string;
  readonly backupSetId: string;
  readonly manifestDigest: string;
  readonly reasonCode: string;
  readonly now: Date;
}

export interface StartRecoveryVerificationOptions extends RecoveryCommandAuditContext {
  readonly recoveryOperationId: string;
  readonly expectedExecutionGeneration: number;
  readonly now: Date;
}

export interface CompleteRecoveryVerificationOptions extends RecoveryCommandAuditContext {
  readonly recoveryOperationId: string;
  readonly expectedExecutionGeneration: number;
  readonly verificationResultDigest: string;
  readonly verificationSummary: RecoveryVerificationSummary;
  readonly now: Date;
}

export interface RecordRecoveryVerificationFailureOptions extends RecoveryCommandAuditContext {
  readonly recoveryOperationId: string;
  readonly expectedExecutionGeneration: number;
  readonly failureCode: string;
  readonly now: Date;
}

export interface ActivateRecoveryOptions extends RecoveryCommandAuditContext {
  readonly recoveryOperationId: string;
  readonly expectedExecutionGeneration: number;
  readonly verificationResultDigest: string;
  readonly activationAckDigest: string;
  readonly now: Date;
}

export interface AbortRecoveryOptions extends RecoveryCommandAuditContext {
  readonly recoveryOperationId: string;
  readonly expectedExecutionGeneration: number;
  readonly reasonCode: string;
  readonly now: Date;
}

export interface RecoveryOperationStore {
  begin(options: BeginRecoveryOptions): Promise<RecoveryOperationResult>;
  startVerification(
    options: StartRecoveryVerificationOptions,
  ): Promise<RecoveryOperationResult>;
  completeVerification(
    options: CompleteRecoveryVerificationOptions,
  ): Promise<RecoveryOperationResult>;
  recordVerificationFailure(
    options: RecordRecoveryVerificationFailureOptions,
  ): Promise<RecoveryOperationResult>;
  activate(options: ActivateRecoveryOptions): Promise<RecoveryOperationResult>;
  abort(options: AbortRecoveryOptions): Promise<RecoveryOperationResult>;
  read(recoveryOperationId: string): Promise<RecoveryOperationRecord>;
}

export type RecoveryOperationStoreErrorCode =
  | "recovery.invalid_argument"
  | "recovery.instance_missing"
  | "recovery.operation_missing"
  | "recovery.operation_conflict"
  | "recovery.concurrent_operation"
  | "recovery.runtime_state_disallowed"
  | "recovery.stale_execution_generation"
  | "recovery.generation_exhausted"
  | "recovery.concurrent_change";

export class RecoveryOperationStoreError extends Error {
  constructor(
    readonly code: RecoveryOperationStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RecoveryOperationStoreError";
  }
}

interface RuntimeStateRow extends RowDataPacket {
  readonly state: InstanceRuntimeState;
  readonly executionGeneration: number;
  readonly stateVersion: number;
}

interface RecoveryOperationRow extends RowDataPacket {
  readonly id: string;
  readonly instanceId: string;
  readonly backupSetId: string;
  readonly manifestDigest: string;
  readonly lifecycleStatus: RecoveryOperationLifecycleStatus;
  readonly fencedExecutionGeneration: number;
  readonly beginStateVersion: number;
  readonly verificationResultDigest: string | null;
  readonly verificationSummary: unknown;
  readonly activationAckDigest: string | null;
  readonly lastFailureCode: string | null;
  readonly version: number;
  readonly startedAt: Date;
  readonly verificationStartedAt: Date | null;
  readonly verifiedAt: Date | null;
  readonly activatedAt: Date | null;
  readonly abortedAt: Date | null;
  readonly updatedAt: Date;
}

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

function fail(code: RecoveryOperationStoreErrorCode, message: string): never {
  throw new RecoveryOperationStoreError(code, message);
}

function invalid(message: string): never {
  return fail("recovery.invalid_argument", message);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    invalid(`${label} must be a canonical uppercase ULID.`);
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    invalid(`${label} must be a canonical SHA-256 digest.`);
  }
}

function assertReasonCode(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !reasonCodePattern.test(value)) {
    invalid(`${label} must be a bounded stable reason code.`);
  }
}

function assertDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalid(`${label} must be a valid Date.`);
  }
}

function assertUint32(value: unknown, label: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximumUint32
  ) {
    invalid(`${label} must be a positive unsigned 32-bit integer.`);
  }
}

function assertUnsignedDecimal(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/u.test(value)) {
    invalid(`${label} must be an unsigned decimal string.`);
  }
}

function assertAudit(context: RecoveryCommandAuditContext): void {
  assertId(context.auditEventId, "auditEventId");
  assertDigest(context.authenticationRefHash, "authenticationRefHash");
}

function assertSummary(summary: RecoveryVerificationSummary): void {
  assertUint32(
    summary.schemaMigrationCount,
    "verificationSummary.schemaMigrationCount",
  );
  assertUnsignedDecimal(
    summary.storedObjectReferenceCount,
    "verificationSummary.storedObjectReferenceCount",
  );
  assertUnsignedDecimal(
    summary.verifiedObjectCount,
    "verificationSummary.verifiedObjectCount",
  );
  if (summary.storedObjectReferenceCount !== summary.verifiedObjectCount) {
    invalid("Verification summary must prove every stored object reference.");
  }
  assertUint32(
    summary.invariantCheckCount,
    "verificationSummary.invariantCheckCount",
  );
  assertUnsignedDecimal(
    summary.pendingOutboxCount,
    "verificationSummary.pendingOutboxCount",
  );
  assertUnsignedDecimal(
    summary.unknownBudgetReservationCount,
    "verificationSummary.unknownBudgetReservationCount",
  );
  assertUnsignedDecimal(
    summary.auditEventCount,
    "verificationSummary.auditEventCount",
  );
}

function canonicalSummary(summary: RecoveryVerificationSummary): string {
  return JSON.stringify({
    auditEventCount: summary.auditEventCount,
    invariantCheckCount: summary.invariantCheckCount,
    pendingOutboxCount: summary.pendingOutboxCount,
    schemaMigrationCount: summary.schemaMigrationCount,
    storedObjectReferenceCount: summary.storedObjectReferenceCount,
    unknownBudgetReservationCount: summary.unknownBudgetReservationCount,
    verifiedObjectCount: summary.verifiedObjectCount,
  });
}

function parseSummary(value: unknown): RecoveryVerificationSummary {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return fail(
        "recovery.operation_conflict",
        "Persisted recovery verification summary is invalid.",
      );
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(
      "recovery.operation_conflict",
      "Persisted recovery verification summary is invalid.",
    );
  }
  const record = parsed as Record<string, unknown>;
  const summary = {
    schemaMigrationCount: record.schemaMigrationCount,
    storedObjectReferenceCount: record.storedObjectReferenceCount,
    verifiedObjectCount: record.verifiedObjectCount,
    invariantCheckCount: record.invariantCheckCount,
    pendingOutboxCount: record.pendingOutboxCount,
    unknownBudgetReservationCount: record.unknownBudgetReservationCount,
    auditEventCount: record.auditEventCount,
  } as RecoveryVerificationSummary;
  assertSummary(summary);
  return Object.freeze({ ...summary });
}

function operationFrom(row: RecoveryOperationRow): RecoveryOperationRecord {
  return Object.freeze({
    id: row.id,
    instanceId: row.instanceId,
    backupSetId: row.backupSetId,
    manifestDigest: row.manifestDigest,
    lifecycleStatus: row.lifecycleStatus,
    fencedExecutionGeneration: row.fencedExecutionGeneration,
    beginStateVersion: row.beginStateVersion,
    ...(row.verificationResultDigest
      ? {
          verificationResultDigest: row.verificationResultDigest,
        }
      : {}),
    ...(row.verificationSummary === null
      ? {}
      : {
          verificationSummary: parseSummary(row.verificationSummary),
        }),
    ...(row.activationAckDigest
      ? { activationAckDigest: row.activationAckDigest }
      : {}),
    ...(row.lastFailureCode ? { lastFailureCode: row.lastFailureCode } : {}),
    version: row.version,
    startedAt: row.startedAt,
    ...(row.verificationStartedAt
      ? {
          verificationStartedAt: row.verificationStartedAt,
        }
      : {}),
    ...(row.verifiedAt ? { verifiedAt: row.verifiedAt } : {}),
    ...(row.activatedAt ? { activatedAt: row.activatedAt } : {}),
    ...(row.abortedAt ? { abortedAt: row.abortedAt } : {}),
    updatedAt: row.updatedAt,
  });
}

function withReplay(
  operation: RecoveryOperationRecord,
  replayed: boolean,
): RecoveryOperationResult {
  return Object.freeze({ ...operation, replayed });
}

async function inTransaction<TResult>(
  pool: Pool,
  callback: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function lockRuntime(
  connection: PoolConnection,
  instanceId: string,
): Promise<RuntimeStateRow> {
  const [rows] = await connection.execute<RuntimeStateRow[]>(
    `SELECT
       state,
       execution_generation AS executionGeneration,
       state_version AS stateVersion
     FROM instance_runtime_state
     WHERE instance_id = ?
     FOR UPDATE`,
    [instanceId],
  );
  const row = rows[0];
  if (!row) {
    return fail(
      "recovery.instance_missing",
      "Configured instance runtime state is missing.",
    );
  }
  return row;
}

const operationProjection = `
  id,
  instance_id AS instanceId,
  backup_set_id AS backupSetId,
  manifest_digest AS manifestDigest,
  lifecycle_status AS lifecycleStatus,
  fenced_execution_generation AS fencedExecutionGeneration,
  begin_state_version AS beginStateVersion,
  verification_result_digest AS verificationResultDigest,
  verification_summary AS verificationSummary,
  activation_ack_digest AS activationAckDigest,
  last_failure_code AS lastFailureCode,
  version,
  started_at AS startedAt,
  verification_started_at AS verificationStartedAt,
  verified_at AS verifiedAt,
  activated_at AS activatedAt,
  aborted_at AS abortedAt,
  updated_at AS updatedAt`;

async function readOperation(
  connection: PoolConnection,
  instanceId: string,
  recoveryOperationId: string,
  lock: boolean,
): Promise<RecoveryOperationRow | undefined> {
  const [rows] = await connection.execute<RecoveryOperationRow[]>(
    `SELECT ${operationProjection}
     FROM recovery_operation
     WHERE instance_id = ?
       AND id = ?
     ${lock ? "FOR UPDATE" : ""}`,
    [instanceId, recoveryOperationId],
  );
  return rows[0];
}

async function requireOperation(
  connection: PoolConnection,
  instanceId: string,
  recoveryOperationId: string,
): Promise<RecoveryOperationRow> {
  const row = await readOperation(
    connection,
    instanceId,
    recoveryOperationId,
    true,
  );
  if (!row) {
    return fail(
      "recovery.operation_missing",
      "Recovery operation does not exist.",
    );
  }
  return row;
}

function assertCurrentGeneration(
  runtime: RuntimeStateRow,
  operation: RecoveryOperationRow,
  expectedExecutionGeneration: number,
): void {
  if (operation.fencedExecutionGeneration !== expectedExecutionGeneration) {
    fail(
      "recovery.stale_execution_generation",
      "Recovery execution generation is stale.",
    );
  }
  if (runtime.executionGeneration !== expectedExecutionGeneration) {
    fail(
      "recovery.stale_execution_generation",
      "Recovery execution generation is stale.",
    );
  }
}

function assertReplayGeneration(
  operation: RecoveryOperationRow,
  expectedExecutionGeneration: number,
): void {
  if (operation.fencedExecutionGeneration !== expectedExecutionGeneration) {
    fail(
      "recovery.stale_execution_generation",
      "Recovery replay execution generation is stale.",
    );
  }
}

function assertRuntimeMatchesOperation(
  runtime: RuntimeStateRow,
  operation: RecoveryOperationRow,
): void {
  let expected: Pick<RuntimeStateRow, "executionGeneration" | "state">;
  if (operation.lifecycleStatus === "restoring") {
    expected = {
      state: "RESTORING",
      executionGeneration: operation.fencedExecutionGeneration,
    };
  } else if (operation.lifecycleStatus === "verifying") {
    expected = {
      state: "VERIFYING",
      executionGeneration: operation.fencedExecutionGeneration,
    };
  } else if (operation.lifecycleStatus === "read_only") {
    expected = {
      state: "READ_ONLY",
      executionGeneration: operation.fencedExecutionGeneration,
    };
  } else if (operation.lifecycleStatus === "active") {
    expected = {
      state: "ACTIVE",
      executionGeneration: operation.fencedExecutionGeneration + 1,
    };
  } else {
    expected = {
      state: "MAINTENANCE",
      executionGeneration: operation.fencedExecutionGeneration + 1,
    };
  }

  if (
    runtime.state !== expected.state ||
    runtime.executionGeneration !== expected.executionGeneration ||
    runtime.stateVersion < operation.beginStateVersion
  ) {
    fail(
      "recovery.operation_conflict",
      "Recovery operation conflicts with persisted runtime state.",
    );
  }
}

function nextUint32(value: number): number {
  if (value >= maximumUint32) {
    return fail(
      "recovery.generation_exhausted",
      "Runtime generation or state version is exhausted.",
    );
  }
  return value + 1;
}

async function updateRuntime(
  connection: PoolConnection,
  instanceId: string,
  current: RuntimeStateRow,
  next: {
    readonly state: InstanceRuntimeState;
    readonly executionGeneration: number;
    readonly reason: string;
    readonly now: Date;
  },
): Promise<number> {
  const stateVersion = nextUint32(current.stateVersion);
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE instance_runtime_state
     SET state = ?,
         execution_generation = ?,
         state_version = ?,
         reason = ?,
         deadline = NULL,
         changed_by = 'cli-recovery',
         changed_at = ?
     WHERE instance_id = ?
       AND state_version = ?`,
    [
      next.state,
      next.executionGeneration,
      stateVersion,
      next.reason,
      next.now,
      instanceId,
      current.stateVersion,
    ],
  );
  if (result.affectedRows !== 1) {
    return fail(
      "recovery.concurrent_change",
      "Instance runtime state changed concurrently.",
    );
  }
  return stateVersion;
}

async function appendRecoveryAudit(
  connection: PoolConnection,
  options: RecoveryCommandAuditContext & {
    readonly recoveryOperationId: string;
    readonly backupSetId: string;
    readonly manifestDigest: string;
    readonly action: string;
    readonly outcome: "succeeded" | "failed";
    readonly severity: "warning" | "high" | "critical";
    readonly decisionReasonCode: string;
    readonly details: Readonly<Record<string, string | number | boolean>>;
    readonly now: Date;
  },
): Promise<void> {
  await appendAuditEventInTransaction(connection, {
    id: options.auditEventId,
    schemaVersion: auditEventSchemaVersion,
    organizationId: null,
    workspaceId: null,
    actorPrincipalId: null,
    actorType: "system",
    authenticationRefType: "cli_recovery",
    authenticationRefHash: options.authenticationRefHash,
    authorityType: "system",
    authorityId: null,
    authorityVersion: null,
    authorizationModelVersion,
    authorizationDecision: {
      command: options.action,
      authority: "isolated_recovery_cli",
      backupSetId: options.backupSetId,
      manifestDigest: options.manifestDigest,
    },
    eventType: `recovery.${options.action}`,
    action: options.action,
    resourceType: "recovery_operation",
    resourceId: options.recoveryOperationId,
    outcome: options.outcome,
    decisionReasonCode: options.decisionReasonCode,
    severity: options.severity,
    requestId: null,
    traceId: null,
    details: options.details,
    occurredAt: options.now,
    recordedAt: options.now,
  });
}

function validateCommon(
  instanceId: string,
  options: RecoveryCommandAuditContext & {
    readonly recoveryOperationId: string;
    readonly now: Date;
  },
): void {
  if (
    instanceId.length < 1 ||
    instanceId.length > 120 ||
    instanceId !== instanceId.trim() ||
    [...instanceId].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    invalid("instanceId is invalid.");
  }
  assertId(options.recoveryOperationId, "recoveryOperationId");
  assertAudit(options);
  assertDate(options.now, "now");
}

export function createRecoveryOperationStore(
  pool: Pool,
  options: { readonly instanceId: string },
): RecoveryOperationStore {
  const instanceId = options.instanceId;

  return Object.freeze({
    async begin(
      command: BeginRecoveryOptions,
    ): Promise<RecoveryOperationResult> {
      validateCommon(instanceId, command);
      assertId(command.backupSetId, "backupSetId");
      assertDigest(command.manifestDigest, "manifestDigest");
      assertReasonCode(command.reasonCode, "reasonCode");

      return inTransaction(pool, async (connection) => {
        const runtime = await lockRuntime(connection, instanceId);
        const existing = await readOperation(
          connection,
          instanceId,
          command.recoveryOperationId,
          true,
        );
        if (existing) {
          if (
            existing.backupSetId !== command.backupSetId ||
            existing.manifestDigest !== command.manifestDigest ||
            existing.lifecycleStatus === "aborted"
          ) {
            return fail(
              "recovery.operation_conflict",
              "Recovery begin replay conflicts with persisted facts.",
            );
          }
          assertRuntimeMatchesOperation(runtime, existing);
          return withReplay(operationFrom(existing), true);
        }

        const [activeRows] = await connection.execute<CountRow[]>(
          `SELECT COUNT(*) AS count
             FROM recovery_operation
             WHERE instance_id = ?
               AND lifecycle_status IN (
                 'restoring',
                 'verifying',
                 'read_only'
               )`,
          [instanceId],
        );
        if (Number(activeRows[0]?.count ?? 0) > 0) {
          return fail(
            "recovery.concurrent_operation",
            "Another recovery operation is already active.",
          );
        }
        if (runtime.state !== "MAINTENANCE") {
          return fail(
            "recovery.runtime_state_disallowed",
            "Recovery can begin only from MAINTENANCE.",
          );
        }

        const executionGeneration = nextUint32(runtime.executionGeneration);
        const stateVersion = await updateRuntime(
          connection,
          instanceId,
          runtime,
          {
            state: "RESTORING",
            executionGeneration,
            reason: command.reasonCode,
            now: command.now,
          },
        );
        await connection.execute(
          `INSERT INTO recovery_operation (
             id, instance_id, backup_set_id, manifest_digest,
             lifecycle_status, fenced_execution_generation,
             begin_state_version, verification_result_digest,
             verification_summary, activation_ack_digest,
             last_failure_code, version, started_at,
             verification_started_at, verified_at, activated_at,
             aborted_at, updated_at
           ) VALUES (
             ?, ?, ?, ?, 'restoring', ?, ?, NULL, NULL, NULL,
             NULL, 1, ?, NULL, NULL, NULL, NULL, ?
           )`,
          [
            command.recoveryOperationId,
            instanceId,
            command.backupSetId,
            command.manifestDigest,
            executionGeneration,
            stateVersion,
            command.now,
            command.now,
          ],
        );
        await appendRecoveryAudit(connection, {
          ...command,
          action: "begin",
          outcome: "succeeded",
          severity: "critical",
          decisionReasonCode: command.reasonCode,
          details: {
            previousRuntimeState: runtime.state,
            previousExecutionGeneration: runtime.executionGeneration,
            fencedExecutionGeneration: executionGeneration,
            runtimeState: "RESTORING",
          },
        });
        const created = await requireOperation(
          connection,
          instanceId,
          command.recoveryOperationId,
        );
        return withReplay(operationFrom(created), false);
      });
    },

    async startVerification(
      command: StartRecoveryVerificationOptions,
    ): Promise<RecoveryOperationResult> {
      validateCommon(instanceId, command);
      assertUint32(
        command.expectedExecutionGeneration,
        "expectedExecutionGeneration",
      );
      return inTransaction(pool, async (connection) => {
        const runtime = await lockRuntime(connection, instanceId);
        const operation = await requireOperation(
          connection,
          instanceId,
          command.recoveryOperationId,
        );
        if (
          operation.lifecycleStatus === "verifying" ||
          operation.lifecycleStatus === "read_only" ||
          operation.lifecycleStatus === "active"
        ) {
          assertReplayGeneration(
            operation,
            command.expectedExecutionGeneration,
          );
          assertRuntimeMatchesOperation(runtime, operation);
          return withReplay(operationFrom(operation), true);
        }
        assertCurrentGeneration(
          runtime,
          operation,
          command.expectedExecutionGeneration,
        );
        if (
          operation.lifecycleStatus !== "restoring" ||
          runtime.state !== "RESTORING"
        ) {
          return fail(
            "recovery.runtime_state_disallowed",
            "Recovery verification cannot start from the current state.",
          );
        }
        await updateRuntime(connection, instanceId, runtime, {
          state: "VERIFYING",
          executionGeneration: runtime.executionGeneration,
          reason: "recovery.verification_started",
          now: command.now,
        });
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE recovery_operation
             SET lifecycle_status = 'verifying',
                 verification_started_at = ?,
                 last_failure_code = NULL,
                 version = version + 1,
                 updated_at = ?
             WHERE instance_id = ?
               AND id = ?
               AND version = ?`,
          [
            command.now,
            command.now,
            instanceId,
            command.recoveryOperationId,
            operation.version,
          ],
        );
        if (result.affectedRows !== 1) {
          return fail(
            "recovery.concurrent_change",
            "Recovery operation changed concurrently.",
          );
        }
        await appendRecoveryAudit(connection, {
          ...command,
          backupSetId: operation.backupSetId,
          manifestDigest: operation.manifestDigest,
          action: "verification_started",
          outcome: "succeeded",
          severity: "high",
          decisionReasonCode: "recovery.verification_started",
          details: {
            fencedExecutionGeneration: operation.fencedExecutionGeneration,
            runtimeState: "VERIFYING",
          },
        });
        const updated = await requireOperation(
          connection,
          instanceId,
          command.recoveryOperationId,
        );
        return withReplay(operationFrom(updated), false);
      });
    },

    async completeVerification(
      command: CompleteRecoveryVerificationOptions,
    ): Promise<RecoveryOperationResult> {
      validateCommon(instanceId, command);
      assertUint32(
        command.expectedExecutionGeneration,
        "expectedExecutionGeneration",
      );
      assertDigest(
        command.verificationResultDigest,
        "verificationResultDigest",
      );
      assertSummary(command.verificationSummary);
      const summaryJson = canonicalSummary(command.verificationSummary);

      return inTransaction(pool, async (connection) => {
        const runtime = await lockRuntime(connection, instanceId);
        const operation = await requireOperation(
          connection,
          instanceId,
          command.recoveryOperationId,
        );
        if (
          operation.lifecycleStatus === "read_only" ||
          operation.lifecycleStatus === "active"
        ) {
          assertReplayGeneration(
            operation,
            command.expectedExecutionGeneration,
          );
          assertRuntimeMatchesOperation(runtime, operation);
          if (
            operation.verificationResultDigest !==
              command.verificationResultDigest ||
            !operation.verificationSummary ||
            canonicalSummary(parseSummary(operation.verificationSummary)) !==
              summaryJson
          ) {
            return fail(
              "recovery.operation_conflict",
              "Recovery verification replay conflicts with persisted evidence.",
            );
          }
          return withReplay(operationFrom(operation), true);
        }
        assertCurrentGeneration(
          runtime,
          operation,
          command.expectedExecutionGeneration,
        );
        if (
          operation.lifecycleStatus !== "verifying" ||
          runtime.state !== "VERIFYING"
        ) {
          return fail(
            "recovery.runtime_state_disallowed",
            "Recovery verification cannot complete from the current state.",
          );
        }
        await updateRuntime(connection, instanceId, runtime, {
          state: "READ_ONLY",
          executionGeneration: runtime.executionGeneration,
          reason: "recovery.verification_passed",
          now: command.now,
        });
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE recovery_operation
             SET lifecycle_status = 'read_only',
                 verification_result_digest = ?,
                 verification_summary = CAST(? AS JSON),
                 verified_at = ?,
                 last_failure_code = NULL,
                 version = version + 1,
                 updated_at = ?
             WHERE instance_id = ?
               AND id = ?
               AND version = ?`,
          [
            command.verificationResultDigest,
            summaryJson,
            command.now,
            command.now,
            instanceId,
            command.recoveryOperationId,
            operation.version,
          ],
        );
        if (result.affectedRows !== 1) {
          return fail(
            "recovery.concurrent_change",
            "Recovery operation changed concurrently.",
          );
        }
        await appendRecoveryAudit(connection, {
          ...command,
          backupSetId: operation.backupSetId,
          manifestDigest: operation.manifestDigest,
          action: "verification_passed",
          outcome: "succeeded",
          severity: "critical",
          decisionReasonCode: "recovery.verification_passed",
          details: {
            fencedExecutionGeneration: operation.fencedExecutionGeneration,
            runtimeState: "READ_ONLY",
            verificationResultDigest: command.verificationResultDigest,
            storedObjectReferenceCount:
              command.verificationSummary.storedObjectReferenceCount,
            invariantCheckCount:
              command.verificationSummary.invariantCheckCount,
          },
        });
        const updated = await requireOperation(
          connection,
          instanceId,
          command.recoveryOperationId,
        );
        return withReplay(operationFrom(updated), false);
      });
    },

    async recordVerificationFailure(
      command: RecordRecoveryVerificationFailureOptions,
    ): Promise<RecoveryOperationResult> {
      validateCommon(instanceId, command);
      assertUint32(
        command.expectedExecutionGeneration,
        "expectedExecutionGeneration",
      );
      assertReasonCode(command.failureCode, "failureCode");
      return inTransaction(pool, async (connection) => {
        const runtime = await lockRuntime(connection, instanceId);
        const operation = await requireOperation(
          connection,
          instanceId,
          command.recoveryOperationId,
        );
        assertCurrentGeneration(
          runtime,
          operation,
          command.expectedExecutionGeneration,
        );
        if (
          operation.lifecycleStatus !== "verifying" ||
          runtime.state !== "VERIFYING"
        ) {
          return fail(
            "recovery.runtime_state_disallowed",
            "Recovery verification failure is not accepted in the current state.",
          );
        }
        const replayed = operation.lastFailureCode === command.failureCode;
        if (!replayed) {
          const [result] = await connection.execute<ResultSetHeader>(
            `UPDATE recovery_operation
               SET last_failure_code = ?,
                   version = version + 1,
                   updated_at = ?
               WHERE instance_id = ?
                 AND id = ?
                 AND version = ?`,
            [
              command.failureCode,
              command.now,
              instanceId,
              command.recoveryOperationId,
              operation.version,
            ],
          );
          if (result.affectedRows !== 1) {
            return fail(
              "recovery.concurrent_change",
              "Recovery operation changed concurrently.",
            );
          }
          await appendRecoveryAudit(connection, {
            ...command,
            backupSetId: operation.backupSetId,
            manifestDigest: operation.manifestDigest,
            action: "verification_failed",
            outcome: "failed",
            severity: "critical",
            decisionReasonCode: command.failureCode,
            details: {
              fencedExecutionGeneration: operation.fencedExecutionGeneration,
              runtimeState: "VERIFYING",
              failureCode: command.failureCode,
            },
          });
        }
        const updated = await requireOperation(
          connection,
          instanceId,
          command.recoveryOperationId,
        );
        return withReplay(operationFrom(updated), replayed);
      });
    },

    async activate(
      command: ActivateRecoveryOptions,
    ): Promise<RecoveryOperationResult> {
      validateCommon(instanceId, command);
      assertUint32(
        command.expectedExecutionGeneration,
        "expectedExecutionGeneration",
      );
      assertDigest(
        command.verificationResultDigest,
        "verificationResultDigest",
      );
      assertDigest(command.activationAckDigest, "activationAckDigest");
      return inTransaction(pool, async (connection) => {
        const runtime = await lockRuntime(connection, instanceId);
        const operation = await requireOperation(
          connection,
          instanceId,
          command.recoveryOperationId,
        );
        if (operation.lifecycleStatus === "active") {
          assertReplayGeneration(
            operation,
            command.expectedExecutionGeneration,
          );
          assertRuntimeMatchesOperation(runtime, operation);
          if (
            operation.activationAckDigest !== command.activationAckDigest ||
            operation.verificationResultDigest !==
              command.verificationResultDigest
          ) {
            return fail(
              "recovery.operation_conflict",
              "Recovery activation replay conflicts with persisted evidence.",
            );
          }
          return withReplay(operationFrom(operation), true);
        }
        assertCurrentGeneration(
          runtime,
          operation,
          command.expectedExecutionGeneration,
        );
        if (
          operation.lifecycleStatus !== "read_only" ||
          runtime.state !== "READ_ONLY" ||
          operation.verificationResultDigest !==
            command.verificationResultDigest
        ) {
          return fail(
            "recovery.runtime_state_disallowed",
            "Recovery activation requires matching verified read-only evidence.",
          );
        }
        const activeGeneration = nextUint32(runtime.executionGeneration);
        await updateRuntime(connection, instanceId, runtime, {
          state: "ACTIVE",
          executionGeneration: activeGeneration,
          reason: "recovery.activated",
          now: command.now,
        });
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE recovery_operation
             SET lifecycle_status = 'active',
                 activation_ack_digest = ?,
                 activated_at = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE instance_id = ?
               AND id = ?
               AND version = ?`,
          [
            command.activationAckDigest,
            command.now,
            command.now,
            instanceId,
            command.recoveryOperationId,
            operation.version,
          ],
        );
        if (result.affectedRows !== 1) {
          return fail(
            "recovery.concurrent_change",
            "Recovery operation changed concurrently.",
          );
        }
        await appendRecoveryAudit(connection, {
          ...command,
          backupSetId: operation.backupSetId,
          manifestDigest: operation.manifestDigest,
          action: "activated",
          outcome: "succeeded",
          severity: "critical",
          decisionReasonCode: "recovery.activated",
          details: {
            fencedExecutionGeneration: operation.fencedExecutionGeneration,
            activeExecutionGeneration: activeGeneration,
            runtimeState: "ACTIVE",
            verificationResultDigest: command.verificationResultDigest,
            activationAckDigest: command.activationAckDigest,
          },
        });
        const updated = await requireOperation(
          connection,
          instanceId,
          command.recoveryOperationId,
        );
        return withReplay(operationFrom(updated), false);
      });
    },

    async abort(
      command: AbortRecoveryOptions,
    ): Promise<RecoveryOperationResult> {
      validateCommon(instanceId, command);
      assertUint32(
        command.expectedExecutionGeneration,
        "expectedExecutionGeneration",
      );
      assertReasonCode(command.reasonCode, "reasonCode");
      return inTransaction(pool, async (connection) => {
        const runtime = await lockRuntime(connection, instanceId);
        const operation = await requireOperation(
          connection,
          instanceId,
          command.recoveryOperationId,
        );
        if (operation.lifecycleStatus === "aborted") {
          assertReplayGeneration(
            operation,
            command.expectedExecutionGeneration,
          );
          assertRuntimeMatchesOperation(runtime, operation);
          return withReplay(operationFrom(operation), true);
        }
        assertCurrentGeneration(
          runtime,
          operation,
          command.expectedExecutionGeneration,
        );
        if (
          operation.lifecycleStatus === "active" ||
          !["RESTORING", "VERIFYING", "READ_ONLY"].includes(runtime.state)
        ) {
          return fail(
            "recovery.runtime_state_disallowed",
            "Active or unrelated runtime state cannot be aborted as recovery.",
          );
        }
        const maintenanceGeneration = nextUint32(runtime.executionGeneration);
        await updateRuntime(connection, instanceId, runtime, {
          state: "MAINTENANCE",
          executionGeneration: maintenanceGeneration,
          reason: command.reasonCode,
          now: command.now,
        });
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE recovery_operation
             SET lifecycle_status = 'aborted',
                 activation_ack_digest = NULL,
                 activated_at = NULL,
                 last_failure_code = NULL,
                 aborted_at = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE instance_id = ?
               AND id = ?
               AND version = ?`,
          [
            command.now,
            command.now,
            instanceId,
            command.recoveryOperationId,
            operation.version,
          ],
        );
        if (result.affectedRows !== 1) {
          return fail(
            "recovery.concurrent_change",
            "Recovery operation changed concurrently.",
          );
        }
        await appendRecoveryAudit(connection, {
          ...command,
          backupSetId: operation.backupSetId,
          manifestDigest: operation.manifestDigest,
          action: "aborted",
          outcome: "succeeded",
          severity: "critical",
          decisionReasonCode: command.reasonCode,
          details: {
            fencedExecutionGeneration: operation.fencedExecutionGeneration,
            maintenanceExecutionGeneration: maintenanceGeneration,
            runtimeState: "MAINTENANCE",
          },
        });
        const updated = await requireOperation(
          connection,
          instanceId,
          command.recoveryOperationId,
        );
        return withReplay(operationFrom(updated), false);
      });
    },

    async read(recoveryOperationId: string): Promise<RecoveryOperationRecord> {
      assertId(recoveryOperationId, "recoveryOperationId");
      const connection = await pool.getConnection();
      try {
        const row = await readOperation(
          connection,
          instanceId,
          recoveryOperationId,
          false,
        );
        if (!row) {
          return fail(
            "recovery.operation_missing",
            "Recovery operation does not exist.",
          );
        }
        return operationFrom(row);
      } finally {
        connection.release();
      }
    },
  });
}
