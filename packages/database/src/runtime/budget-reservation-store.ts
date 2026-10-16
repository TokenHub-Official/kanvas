import { agentModelCallAdmitted } from "./agent-model-call-admission.js";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import type {
  TrustedWorkspaceScope,
  AgentModelCallPurpose,
} from "@kanvas/application";

import type { AuditJsonObject } from "./audit-event-store.js";
import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import {
  decimalToUnits,
  decimalUnitsToString,
  normalizeUnsignedDecimal,
  signedDecimalToUnits,
} from "./fixed-decimal.js";
import { canonicalizeProviderValue } from "./provider-value-digest.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const currencyPattern = /^[A-Z]{3}$/u;
const keyPattern = /^[\x21-\x7e]+$/u;

export type BudgetReservationStatus = "reserved" | "replayed" | "rejected";
export type BudgetRejectionReason =
  | "budget_account_unavailable"
  | "budget_period_inactive"
  | "budget_hard_limit_exceeded";
export type BudgetFinalizationKind =
  "capture" | "release" | "expire" | "unknown_hold";

function finalizationLifecycle(
  kind: BudgetFinalizationKind,
): "released" | "settled" | "unknown" {
  if (kind === "capture") {
    return "settled";
  }
  return kind === "unknown_hold" ? "unknown" : "released";
}

function finalizationLedgerKind(
  kind: BudgetFinalizationKind,
): "consume" | "expire" | "release" | "unknown_hold" {
  if (kind === "capture") {
    return "consume";
  }
  if (kind === "unknown_hold") {
    return "unknown_hold";
  }
  return kind === "expire" ? "expire" : "release";
}

interface ReserveBudgetBase {
  readonly reservationId: string;
  readonly ledgerEntryId: string;
  readonly workspaceId: string;
  readonly budgetAccountId: string;
  readonly reservationKey: string;
  readonly requestDigest: string;
  readonly pricingRevisionId: string;
  /**
   * When present, the invocation is locked, validated against the complete
   * attempt/pricing pin, and bound to the new reservation in this transaction.
   */
  readonly currencyCode: string;
  readonly maximumChargeAmount: string;
  readonly expiresAt: Date;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export type ReserveBudgetOptions = ReserveBudgetBase &
  (
    | {
        readonly consumerKind?: "capability_attempt";
        readonly workflowRunId?: string;
        readonly capabilityRunId: string;
        readonly capabilityAttemptId: string;
        readonly providerInvocationId?: string;
        readonly agentRunId?: never;
        readonly agentModelCallId?: never;
      }
    | {
        readonly consumerKind: "agent_model_call";
        readonly workerClaim?: {
          readonly workerId: string;
          readonly claimTokenDigest: string;
        };
        readonly agentRunId: string;
        readonly agentModelCallId: string;
        readonly workflowRunId?: never;
        readonly capabilityRunId?: never;
        readonly capabilityAttemptId?: never;
        readonly providerInvocationId?: never;
      }
  );

export interface FinalizeBudgetReservationOptions {
  readonly workspaceId: string;
  readonly budgetAccountId: string;
  readonly reservationId: string;
  readonly ledgerEntryId: string;
  readonly ledgerEntryKey: string;
  readonly requestDigest: string;
  readonly kind: BudgetFinalizationKind;
  /**
   * Required for capture and forbidden for all other finalization kinds.
   */
  readonly capturedAmount?: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

interface ResolveUnknownBudgetHoldCommonOptions {
  readonly reservationId: string;
  readonly expectedVersion: number;
  readonly ledgerEntryId: string;
  readonly ledgerEntryKey: string;
  readonly requestDigest: string;
  readonly resolution: "charged" | "not_charged";
  readonly chargedAmount?: string;
  readonly evidenceReference: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface ResolveUnknownBudgetHoldOptions extends ResolveUnknownBudgetHoldCommonOptions {
  readonly scope: TrustedWorkspaceScope;
}

export interface ResolveUnknownBudgetHoldSystemOptions extends ResolveUnknownBudgetHoldCommonOptions {
  readonly workspaceId: string;
}

export type ResolveUnknownBudgetHoldCommand =
  ResolveUnknownBudgetHoldOptions | ResolveUnknownBudgetHoldSystemOptions;

export type BudgetReservationResult =
  | {
      readonly status: "reserved" | "replayed";
      readonly reservationId: string;
      readonly lifecycleStatus: "reserved";
      readonly reservedAmount: string;
      readonly accountVersion: number;
    }
  | {
      readonly status: "rejected";
      readonly reason: BudgetRejectionReason;
      readonly accountVersion: number;
    };

export interface BudgetFinalizationResult {
  readonly status: "finalized" | "replayed";
  readonly reservationId: string;
  readonly lifecycleStatus: "settled" | "released" | "unknown";
  readonly settledAmount: string | null;
  readonly unknownHoldAmount: string | null;
  readonly accountVersion: number;
}

export interface UnknownBudgetHoldResolutionResult {
  readonly status: "resolved" | "replayed";
  readonly reservationId: string;
  readonly lifecycleStatus: "settled" | "released";
  readonly chargedAmount: string;
  readonly resolvedAt: Date;
  readonly accountVersion: number;
}

export interface BudgetReservationStore {
  reserve(options: ReserveBudgetOptions): Promise<BudgetReservationResult>;
  finalize(
    options: FinalizeBudgetReservationOptions,
  ): Promise<BudgetFinalizationResult>;
  resolveUnknown(
    options: ResolveUnknownBudgetHoldCommand,
  ): Promise<UnknownBudgetHoldResolutionResult>;
}

export type BudgetReservationStoreErrorCode =
  | "budget.invalid_argument"
  | "budget.not_found"
  | "budget.identity_conflict"
  | "budget.lifecycle_conflict"
  | "budget.account_corrupt";

export class BudgetReservationStoreError extends Error {
  public constructor(
    public readonly code: BudgetReservationStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BudgetReservationStoreError";
  }
}

interface BudgetAccountRow extends RowDataPacket {
  readonly organizationId: string;
  readonly id: string;
  readonly workspaceId: string;
  readonly currencyCode: string;
  readonly periodStartAt: Date;
  readonly periodEndAt: Date;
  readonly hardLimitAmount: string;
  readonly consumedAmount: string;
  readonly reservedAmount: string;
  readonly unknownHeldAmount: string;
  readonly lifecycleStatus: string;
  readonly version: number;
}

interface BudgetReservationRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly budgetAccountId: string;
  readonly reservationKey: string;
  readonly requestDigest: string;
  readonly workflowRunId: string | null;
  readonly capabilityRunId: string | null;
  readonly capabilityAttemptId: string | null;
  readonly agentModelCallId: string | null;
  readonly pricingRevisionId: string | null;
  readonly currencyCode: string;
  readonly reservedAmount: string;
  readonly settledAmount: string | null;
  readonly unknownHoldAmount: string | null;
  readonly lifecycleStatus:
    "reserved" | "consuming" | "settled" | "released" | "unknown";
  readonly expiresAt: Date;
  readonly version: number;
  readonly settledAt: Date | null;
}

interface AttemptHierarchyRow extends RowDataPacket {
  readonly workflowRunId: string | null;
  readonly capabilityRunId: string;
  readonly capabilityAttemptId: string;
}

interface AgentModelCallPinRow extends RowDataPacket {
  readonly purpose: AgentModelCallPurpose;
  readonly executionDeadlineAt: Date;
  readonly agentRunId: string;
  readonly agentModelCallId: string;
  readonly callStatus: string;
  readonly runStatus: string;
}

interface PricingRow extends RowDataPacket {
  readonly id: string;
  readonly currencyCode: string;
  readonly lifecycleStatus: string;
}

interface InvocationRow extends RowDataPacket {
  readonly id: string;
  readonly capabilityAttemptId: string;
  readonly pricingRevisionId: string | null;
  readonly budgetReservationId: string | null;
}

interface LedgerRow extends RowDataPacket {
  readonly id: string;
  readonly entryKey: string;
  readonly entryKind: string;
  readonly budgetReservationId: string | null;
  readonly currencyCode: string;
  readonly reservedDelta: string;
  readonly consumedDelta: string;
  readonly unknownHeldDelta: string;
  readonly requestDigest: string;
  readonly occurredAt: Date;
}

interface ReservationAccountRow extends RowDataPacket {
  readonly budgetAccountId: string;
}

function fail(code: BudgetReservationStoreErrorCode, message: string): never {
  throw new BudgetReservationStoreError(code, message);
}

function invalid(message: string): never {
  return fail("budget.invalid_argument", message);
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

function assertCurrency(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !currencyPattern.test(value)) {
    invalid(`${label} must be an ISO currency code.`);
  }
}

function assertDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalid(`${label} must be a valid Date.`);
  }
}

function assertKey(
  value: unknown,
  label: string,
  maximumLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    !keyPattern.test(value)
  ) {
    invalid(`${label} must be bounded printable ASCII without spaces.`);
  }
}

function assertReserveOptions(options: ReserveBudgetOptions): void {
  assertId(options.reservationId, "reservationId");
  assertId(options.ledgerEntryId, "ledgerEntryId");
  assertId(options.workspaceId, "workspaceId");
  assertId(options.budgetAccountId, "budgetAccountId");
  assertKey(options.reservationKey, "reservationKey", 191);
  assertDigest(options.requestDigest, "requestDigest");
  if (options.consumerKind === "agent_model_call") {
    assertId(options.agentRunId, "agentRunId");
    assertId(options.agentModelCallId, "agentModelCallId");
  } else {
    if (options.workflowRunId !== undefined) {
      assertId(options.workflowRunId, "workflowRunId");
    }
    assertId(options.capabilityRunId, "capabilityRunId");
    assertId(options.capabilityAttemptId, "capabilityAttemptId");
  }
  assertId(options.pricingRevisionId, "pricingRevisionId");
  if (
    options.consumerKind !== "agent_model_call" &&
    options.providerInvocationId !== undefined
  ) {
    assertId(options.providerInvocationId, "providerInvocationId");
  }
  assertCurrency(options.currencyCode, "currencyCode");
  normalizeUnsignedDecimal(options.maximumChargeAmount, "maximumChargeAmount");
  assertDate(options.expiresAt, "expiresAt");
  assertDate(options.now, "now");
  if (options.expiresAt.getTime() <= options.now.getTime()) {
    invalid("expiresAt must be after now.");
  }
}

function assertFinalizeOptions(
  options: FinalizeBudgetReservationOptions,
): void {
  assertId(options.workspaceId, "workspaceId");
  assertId(options.budgetAccountId, "budgetAccountId");
  assertId(options.reservationId, "reservationId");
  assertId(options.ledgerEntryId, "ledgerEntryId");
  assertKey(options.ledgerEntryKey, "ledgerEntryKey", 191);
  assertDigest(options.requestDigest, "requestDigest");
  assertDate(options.now, "now");
  if (
    options.kind !== "capture" &&
    options.kind !== "release" &&
    options.kind !== "expire" &&
    options.kind !== "unknown_hold"
  ) {
    invalid("kind must be capture, release, expire, or unknown_hold.");
  }
  if (options.kind === "capture") {
    if (options.capturedAmount === undefined) {
      invalid("capturedAmount is required for capture.");
    }
    normalizeUnsignedDecimal(options.capturedAmount, "capturedAmount");
  } else if (options.capturedAmount !== undefined) {
    invalid("capturedAmount is only valid for capture.");
  }
}

function assertResolveUnknownOptions(
  options: ResolveUnknownBudgetHoldCommand,
): void {
  assertId(options.reservationId, "reservationId");
  assertId(options.ledgerEntryId, "ledgerEntryId");
  assertKey(options.ledgerEntryKey, "ledgerEntryKey", 191);
  assertDigest(options.requestDigest, "requestDigest");
  assertDate(options.now, "now");
  if (
    !Number.isSafeInteger(options.expectedVersion) ||
    options.expectedVersion < 1
  ) {
    invalid("expectedVersion must be a positive integer.");
  }
  if (
    options.resolution !== "charged" &&
    options.resolution !== "not_charged"
  ) {
    invalid("resolution must be charged or not_charged.");
  }
  const evidence = options.evidenceReference.trim();
  if (
    evidence.length < 3 ||
    evidence.length > 240 ||
    [...evidence].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    invalid("evidenceReference must be bounded visible text.");
  }
  if (options.resolution === "charged") {
    if (options.chargedAmount === undefined) {
      invalid("chargedAmount is required for a charged resolution.");
    }
    if (decimalToUnits(options.chargedAmount, "chargedAmount") <= 0n) {
      invalid("chargedAmount must be greater than zero.");
    }
  } else if (options.chargedAmount !== undefined) {
    invalid("chargedAmount is only valid for a charged resolution.");
  }
}

async function inTransaction<TResult>(
  pool: Pool,
  work: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function lockAccount(
  connection: PoolConnection,
  workspaceId: string,
  budgetAccountId: string,
): Promise<BudgetAccountRow> {
  const [rows] = await connection.execute<BudgetAccountRow[]>(
    `SELECT
       workspace.organization_id AS organizationId,
       budget_account.id,
       budget_account.workspace_id AS workspaceId,
       budget_account.currency_code AS currencyCode,
       budget_account.period_start_at AS periodStartAt,
       budget_account.period_end_at AS periodEndAt,
       budget_account.hard_limit_amount AS hardLimitAmount,
       budget_account.consumed_amount AS consumedAmount,
       budget_account.reserved_amount AS reservedAmount,
       budget_account.unknown_held_amount AS unknownHeldAmount,
       budget_account.lifecycle_status AS lifecycleStatus,
       budget_account.version
     FROM budget_account
     INNER JOIN workspace
       ON workspace.id = budget_account.workspace_id
     WHERE budget_account.workspace_id = ?
       AND budget_account.id = ?
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, budgetAccountId],
  );
  const row = rows[0];
  if (!row) {
    return fail(
      "budget.not_found",
      "Budget account does not exist in the requested workspace.",
    );
  }
  assertAccountInvariant(row);
  return row;
}

function accountUnits(row: BudgetAccountRow): {
  readonly hard: bigint;
  readonly consumed: bigint;
  readonly reserved: bigint;
  readonly unknown: bigint;
} {
  return {
    hard: decimalToUnits(row.hardLimitAmount, "hardLimitAmount"),
    consumed: decimalToUnits(row.consumedAmount, "consumedAmount"),
    reserved: decimalToUnits(row.reservedAmount, "reservedAmount"),
    unknown: decimalToUnits(row.unknownHeldAmount, "unknownHeldAmount"),
  };
}

function assertAccountInvariant(row: BudgetAccountRow): void {
  const amount = accountUnits(row);
  if (amount.consumed + amount.reserved + amount.unknown > amount.hard) {
    fail(
      "budget.account_corrupt",
      "Budget account balances exceed the hard limit.",
    );
  }
}

async function lockPotentialReservation(
  connection: PoolConnection,
  options: ReserveBudgetOptions,
): Promise<readonly BudgetReservationRow[]> {
  const [rows] = await connection.execute<BudgetReservationRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       budget_account_id AS budgetAccountId,
       reservation_key AS reservationKey,
       request_digest AS requestDigest,
       workflow_run_id AS workflowRunId,
       capability_run_id AS capabilityRunId,
       capability_attempt_id AS capabilityAttemptId,
       agent_model_call_id AS agentModelCallId,
       pricing_revision_id AS pricingRevisionId,
       currency_code AS currencyCode,
       reserved_amount AS reservedAmount,
       settled_amount AS settledAmount,
       lifecycle_status AS lifecycleStatus,
       expires_at AS expiresAt,
       version,
       settled_at AS settledAt
     FROM budget_reservation
     WHERE (
       budget_account_id = ?
       AND reservation_key = ?
     )
     OR capability_attempt_id = ?
     OR agent_model_call_id = ?
     ORDER BY id
     FOR UPDATE`,
    [
      options.budgetAccountId,
      options.reservationKey,
      options.consumerKind === "agent_model_call"
        ? null
        : options.capabilityAttemptId,
      options.consumerKind === "agent_model_call"
        ? options.agentModelCallId
        : null,
    ],
  );
  return rows;
}

function reservationMatches(
  row: BudgetReservationRow,
  options: ReserveBudgetOptions,
): boolean {
  return (
    row.id === options.reservationId &&
    row.workspaceId === options.workspaceId &&
    row.budgetAccountId === options.budgetAccountId &&
    row.reservationKey === options.reservationKey &&
    row.requestDigest === options.requestDigest &&
    row.workflowRunId ===
      (options.consumerKind === "agent_model_call"
        ? null
        : options.workflowRunId) &&
    row.capabilityRunId ===
      (options.consumerKind === "agent_model_call"
        ? null
        : options.capabilityRunId) &&
    row.capabilityAttemptId ===
      (options.consumerKind === "agent_model_call"
        ? null
        : options.capabilityAttemptId) &&
    row.agentModelCallId ===
      (options.consumerKind === "agent_model_call"
        ? options.agentModelCallId
        : null) &&
    row.pricingRevisionId === options.pricingRevisionId &&
    row.currencyCode === options.currencyCode &&
    decimalToUnits(row.reservedAmount) ===
      decimalToUnits(options.maximumChargeAmount) &&
    row.expiresAt.getTime() === options.expiresAt.getTime() &&
    row.lifecycleStatus === "reserved" &&
    row.settledAmount === null &&
    row.settledAt === null
  );
}

async function validateExecutionPins(
  connection: PoolConnection,
  options: ReserveBudgetOptions,
): Promise<void> {
  if (options.consumerKind === "agent_model_call") {
    const [callRows] = await connection.execute<AgentModelCallPinRow[]>(
      `SELECT
         agent_run.id AS agentRunId,
         model_call.id AS agentModelCallId,
         model_call.lifecycle_status AS callStatus,
         model_call.purpose,
         agent_run.execution_deadline_at AS executionDeadlineAt,
         agent_run.lifecycle_status AS runStatus
       FROM agent_model_call AS model_call
       INNER JOIN agent_run
         ON agent_run.workspace_id = model_call.workspace_id
        AND agent_run.id = model_call.agent_run_id
       WHERE model_call.workspace_id = ?
         AND model_call.id = ?
       LIMIT 1
       FOR SHARE`,
      [options.workspaceId, options.agentModelCallId],
    );
    const pin = callRows[0];
    if (
      !pin ||
      pin.agentRunId !== options.agentRunId ||
      pin.agentModelCallId !== options.agentModelCallId ||
      !["pending", "running"].includes(pin.callStatus) ||
      !(await agentModelCallAdmitted(connection, {
        ...options,
        purpose: pin.purpose,
        lifecycleStatus: pin.runStatus,
        executionDeadlineAt: pin.executionDeadlineAt,
      }))
    ) {
      return fail(
        "budget.identity_conflict",
        "Agent Model Call and Agent Run pins are not reservable.",
      );
    }
  } else {
    const [hierarchyRows] = await connection.execute<AttemptHierarchyRow[]>(
      `SELECT
         workflow_run.id AS workflowRunId,
         capability_run.id AS capabilityRunId,
         capability_attempt.id AS capabilityAttemptId
       FROM capability_attempt
       INNER JOIN capability_run
         ON capability_run.workspace_id =
              capability_attempt.workspace_id
        AND capability_run.id =
              capability_attempt.capability_run_id
       LEFT JOIN node_run
         ON node_run.workspace_id = capability_run.workspace_id
        AND node_run.id = capability_run.node_run_id
       LEFT JOIN workflow_run
         ON workflow_run.workspace_id = node_run.workspace_id
        AND workflow_run.id = node_run.workflow_run_id
       WHERE capability_attempt.workspace_id = ?
         AND capability_attempt.id = ?
       LIMIT 1
       FOR SHARE`,
      [options.workspaceId, options.capabilityAttemptId],
    );
    const hierarchy = hierarchyRows[0];
    if (
      !hierarchy ||
      hierarchy.workflowRunId !== (options.workflowRunId ?? null) ||
      hierarchy.capabilityRunId !== options.capabilityRunId ||
      hierarchy.capabilityAttemptId !== options.capabilityAttemptId
    ) {
      return fail(
        "budget.identity_conflict",
        "Attempt, capability, and workflow pins do not form one hierarchy.",
      );
    }
  }

  const [pricingRows] = await connection.execute<PricingRow[]>(
    `SELECT
       id,
       currency_code AS currencyCode,
       lifecycle_status AS lifecycleStatus
     FROM pricing_revision
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     FOR SHARE`,
    [options.workspaceId, options.pricingRevisionId],
  );
  const pricing = pricingRows[0];
  if (
    !pricing ||
    pricing.lifecycleStatus !== "published" ||
    pricing.currencyCode !== options.currencyCode
  ) {
    return fail(
      "budget.identity_conflict",
      "Pricing pin is not a published revision in the reservation currency.",
    );
  }

  if (
    options.consumerKind !== "agent_model_call" &&
    options.providerInvocationId
  ) {
    const [invocationRows] = await connection.execute<InvocationRow[]>(
      `SELECT
           id,
           capability_attempt_id AS capabilityAttemptId,
           pricing_revision_id AS pricingRevisionId,
           budget_reservation_id AS budgetReservationId
         FROM provider_invocation
         WHERE workspace_id = ?
           AND id = ?
         LIMIT 1
         FOR UPDATE`,
      [options.workspaceId, options.providerInvocationId],
    );
    const invocation = invocationRows[0];
    if (
      !invocation ||
      invocation.capabilityAttemptId !== options.capabilityAttemptId ||
      invocation.pricingRevisionId !== options.pricingRevisionId ||
      (invocation.budgetReservationId !== null &&
        invocation.budgetReservationId !== options.reservationId)
    ) {
      return fail(
        "budget.identity_conflict",
        "Provider invocation does not match reservation attempt and pricing pins.",
      );
    }
  }
}

async function bindInvocation(
  connection: PoolConnection,
  options: ReserveBudgetOptions,
): Promise<void> {
  if (
    options.consumerKind === "agent_model_call" ||
    !options.providerInvocationId
  ) {
    return;
  }
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE provider_invocation
     SET budget_reservation_id = ?,
         version = version + 1,
         updated_at = ?
     WHERE workspace_id = ?
       AND id = ?
       AND capability_attempt_id = ?
       AND pricing_revision_id = ?
       AND budget_reservation_id IS NULL`,
    [
      options.reservationId,
      options.now,
      options.workspaceId,
      options.providerInvocationId,
      options.capabilityAttemptId,
      options.pricingRevisionId,
    ],
  );
  if (result.affectedRows !== 1) {
    const [rows] = await connection.execute<InvocationRow[]>(
      `SELECT
         id,
         capability_attempt_id AS capabilityAttemptId,
         pricing_revision_id AS pricingRevisionId,
         budget_reservation_id AS budgetReservationId
       FROM provider_invocation
       WHERE workspace_id = ?
         AND id = ?
       LIMIT 1
       FOR UPDATE`,
      [options.workspaceId, options.providerInvocationId],
    );
    if (rows[0]?.budgetReservationId !== options.reservationId) {
      return fail(
        "budget.identity_conflict",
        "Provider invocation reservation binding lost its compare-and-swap.",
      );
    }
  }
}

async function appendBudgetAudit(
  connection: PoolConnection,
  account: BudgetAccountRow,
  context: ControlPlaneAuditContext,
  event: {
    readonly eventType: string;
    readonly action: string;
    readonly resourceId: string;
    readonly outcome: "succeeded" | "denied";
    readonly decisionReasonCode: string;
    readonly details: AuditJsonObject;
    readonly now: Date;
  },
): Promise<void> {
  await appendControlPlaneAuditEventInTransaction(connection, context, {
    organizationId: account.organizationId,
    workspaceId: account.workspaceId,
    eventType: event.eventType,
    action: event.action,
    resourceType: "budget_reservation",
    resourceId: event.resourceId,
    outcome: event.outcome,
    decisionReasonCode: event.decisionReasonCode,
    severity: event.outcome === "denied" ? "warning" : "info",
    authorizationDecision: {
      authorized: event.outcome === "succeeded",
      accountVersion: account.version,
    },
    details: event.details,
    occurredAt: event.now,
  });
}

function rejectedReason(
  account: BudgetAccountRow,
  options: ReserveBudgetOptions,
  requested: bigint,
): BudgetRejectionReason | undefined {
  if (account.lifecycleStatus !== "active") {
    return "budget_account_unavailable";
  }
  if (
    options.now.getTime() < account.periodStartAt.getTime() ||
    options.now.getTime() >= account.periodEndAt.getTime()
  ) {
    return "budget_period_inactive";
  }
  const current = accountUnits(account);
  if (
    current.consumed + current.reserved + current.unknown + requested >
    current.hard
  ) {
    return "budget_hard_limit_exceeded";
  }
  return undefined;
}

async function loadLedgerByKey(
  connection: PoolConnection,
  accountId: string,
  entryKey: string,
): Promise<LedgerRow | undefined> {
  const [rows] = await connection.execute<LedgerRow[]>(
    `SELECT
       id,
       entry_key AS entryKey,
       entry_kind AS entryKind,
       budget_reservation_id AS budgetReservationId,
       currency_code AS currencyCode,
       reserved_delta AS reservedDelta,
       consumed_delta AS consumedDelta,
       unknown_held_delta AS unknownHeldDelta,
       request_digest AS requestDigest,
       occurred_at AS occurredAt
     FROM budget_ledger_entry
     WHERE budget_account_id = ?
       AND entry_key = ?
     LIMIT 1
     FOR SHARE`,
    [accountId, entryKey],
  );
  return rows[0];
}

function nextAccountLifecycle(
  current: string,
  total: bigint,
  hard: bigint,
): string {
  if (current === "frozen" || current === "closed") {
    return current;
  }
  return total >= hard ? "exhausted" : "active";
}

export function createBudgetReservationStore(
  pool: Pool,
): BudgetReservationStore {
  return Object.freeze({
    async reserve(
      options: ReserveBudgetOptions,
    ): Promise<BudgetReservationResult> {
      assertReserveOptions(options);
      const requested = decimalToUnits(
        options.maximumChargeAmount,
        "maximumChargeAmount",
      );
      const normalizedRequested = decimalUnitsToString(requested);
      const reserveLedgerEntryKey = `reserve:${options.reservationKey}`;
      if (reserveLedgerEntryKey.length > 191) {
        return invalid(
          "reservationKey is too long for the reserve ledger identity.",
        );
      }
      return inTransaction(pool, async (connection) => {
        // The account row is the sole monetary serialization point.
        const account = await lockAccount(
          connection,
          options.workspaceId,
          options.budgetAccountId,
        );
        if (account.currencyCode !== options.currencyCode) {
          return fail(
            "budget.identity_conflict",
            "Reservation currency differs from the account.",
          );
        }
        const existingRows = await lockPotentialReservation(
          connection,
          options,
        );
        if (existingRows.length > 0) {
          const existing = existingRows[0];
          if (
            existingRows.length !== 1 ||
            !existing ||
            !reservationMatches(existing, options)
          ) {
            return fail(
              "budget.identity_conflict",
              "Reservation replay identity conflicts with durable facts.",
            );
          }
          await validateExecutionPins(connection, options);
          const ledger = await loadLedgerByKey(
            connection,
            account.id,
            reserveLedgerEntryKey,
          );
          if (
            !ledger ||
            ledger.id !== options.ledgerEntryId ||
            ledger.entryKind !== "reserve" ||
            ledger.budgetReservationId !== existing.id ||
            ledger.currencyCode !== options.currencyCode ||
            ledger.requestDigest !== options.requestDigest ||
            signedDecimalToUnits(ledger.reservedDelta) !== requested ||
            signedDecimalToUnits(ledger.consumedDelta) !== 0n
          ) {
            return fail(
              "budget.identity_conflict",
              "Reservation replay does not match its append-only ledger entry.",
            );
          }
          if (options.providerInvocationId !== undefined) {
            const [invocationRows] = await connection.execute<InvocationRow[]>(
              `SELECT
                   id,
                   capability_attempt_id AS capabilityAttemptId,
                   pricing_revision_id AS pricingRevisionId,
                   budget_reservation_id AS budgetReservationId
                 FROM provider_invocation
                 WHERE workspace_id = ?
                   AND id = ?
                 LIMIT 1
                 FOR UPDATE`,
              [options.workspaceId, options.providerInvocationId],
            );
            if (invocationRows[0]?.budgetReservationId !== existing.id) {
              return fail(
                "budget.identity_conflict",
                "Replayed invocation is not bound to the reservation.",
              );
            }
          }
          return Object.freeze({
            status: "replayed",
            reservationId: existing.id,
            lifecycleStatus: "reserved",
            reservedAmount: normalizeUnsignedDecimal(existing.reservedAmount),
            accountVersion: account.version,
          });
        }

        await validateExecutionPins(connection, options);
        const reason = rejectedReason(account, options, requested);
        if (reason) {
          await appendBudgetAudit(connection, account, options.audit, {
            eventType: "budget_reservation.rejected",
            action: "reserve",
            resourceId: options.reservationId,
            outcome: "denied",
            decisionReasonCode: reason,
            details: {
              reason,
              currencyCode: options.currencyCode,
              requestedAmount: normalizedRequested,
              accountVersion: account.version,
            },
            now: options.now,
          });
          return Object.freeze({
            status: "rejected",
            reason,
            accountVersion: account.version,
          });
        }

        const before = accountUnits(account);
        const reservedAfter = before.reserved + requested;
        const accountVersion = account.version + 1;
        const [accountResult] = await connection.execute<ResultSetHeader>(
          `UPDATE budget_account
             SET reserved_amount = ?,
                 lifecycle_status = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?
               AND lifecycle_status = 'active'
               AND consumed_amount = ?
               AND reserved_amount = ?
               AND unknown_held_amount = ?`,
          [
            decimalUnitsToString(reservedAfter),
            nextAccountLifecycle(
              account.lifecycleStatus,
              before.consumed + reservedAfter + before.unknown,
              before.hard,
            ),
            options.now,
            options.workspaceId,
            options.budgetAccountId,
            account.version,
            account.consumedAmount,
            account.reservedAmount,
            account.unknownHeldAmount,
          ],
        );
        if (accountResult.affectedRows !== 1) {
          return fail(
            "budget.identity_conflict",
            "Budget account reservation lost its compare-and-swap.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO budget_reservation (
             id,
             workspace_id,
             budget_account_id,
             reservation_key,
             request_digest,
             workflow_run_id,
             capability_run_id,
             capability_attempt_id,
             agent_model_call_id,
             pricing_revision_id,
             currency_code,
             reserved_amount,
             settled_amount,
             unknown_hold_amount,
             lifecycle_status,
             expires_at,
             version,
             created_at,
             updated_at,
             settled_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             NULL, NULL, 'reserved', ?, 1, ?, ?, NULL
           )`,
          [
            options.reservationId,
            options.workspaceId,
            options.budgetAccountId,
            options.reservationKey,
            options.requestDigest,
            options.consumerKind === "agent_model_call"
              ? null
              : (options.workflowRunId ?? null),
            options.consumerKind === "agent_model_call"
              ? null
              : options.capabilityRunId,
            options.consumerKind === "agent_model_call"
              ? null
              : options.capabilityAttemptId,
            options.consumerKind === "agent_model_call"
              ? options.agentModelCallId
              : null,
            options.pricingRevisionId,
            options.currencyCode,
            normalizedRequested,
            options.expiresAt,
            options.now,
            options.now,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO budget_ledger_entry (
             id,
             workspace_id,
             budget_account_id,
             budget_reservation_id,
             entry_key,
             entry_kind,
             currency_code,
             reserved_delta,
             consumed_delta,
             unknown_held_delta,
             reserved_balance_after,
             consumed_balance_after,
             unknown_held_balance_after,
             request_digest,
             evidence,
             corrects_entry_id,
             created_by_principal_id,
             occurred_at,
             recorded_at
           ) VALUES (
             ?, ?, ?, ?, ?, 'reserve', ?, ?, 0, 0, ?, ?, ?, ?, ?,
             NULL, ?, ?, ?
           )`,
          [
            options.ledgerEntryId,
            options.workspaceId,
            options.budgetAccountId,
            options.reservationId,
            reserveLedgerEntryKey,
            options.currencyCode,
            normalizedRequested,
            decimalUnitsToString(reservedAfter),
            account.consumedAmount,
            account.unknownHeldAmount,
            options.requestDigest,
            canonicalizeProviderValue({
              schemaVersion: 1,
              operation: "reserve",
              consumerKind:
                options.consumerKind === "agent_model_call"
                  ? "agent_model_call"
                  : "capability_attempt",
              ...(options.consumerKind === "agent_model_call"
                ? {
                    agentRunId: options.agentRunId,
                    agentModelCallId: options.agentModelCallId,
                  }
                : {
                    ...(options.workflowRunId
                      ? { workflowRunId: options.workflowRunId }
                      : {}),
                    capabilityRunId: options.capabilityRunId,
                    capabilityAttemptId: options.capabilityAttemptId,
                  }),
              pricingRevisionId: options.pricingRevisionId,
            }),
            options.audit.actorPrincipalId,
            options.now,
            options.now,
          ],
        );
        await bindInvocation(connection, options);
        await appendBudgetAudit(connection, account, options.audit, {
          eventType: "budget_reservation.reserved",
          action: "reserve",
          resourceId: options.reservationId,
          outcome: "succeeded",
          decisionReasonCode: "budget.reserved",
          details: {
            currencyCode: options.currencyCode,
            reservedAmount: normalizedRequested,
            accountVersionBefore: account.version,
            accountVersionAfter: accountVersion,
          },
          now: options.now,
        });
        return Object.freeze({
          status: "reserved",
          reservationId: options.reservationId,
          lifecycleStatus: "reserved",
          reservedAmount: normalizedRequested,
          accountVersion,
        });
      });
    },

    async finalize(
      options: FinalizeBudgetReservationOptions,
    ): Promise<BudgetFinalizationResult> {
      assertFinalizeOptions(options);
      return inTransaction(pool, async (connection) => {
        const account = await lockAccount(
          connection,
          options.workspaceId,
          options.budgetAccountId,
        );
        const [reservationRows] = await connection.execute<
          BudgetReservationRow[]
        >(
          `SELECT
               id,
               workspace_id AS workspaceId,
               budget_account_id AS budgetAccountId,
               reservation_key AS reservationKey,
               request_digest AS requestDigest,
               workflow_run_id AS workflowRunId,
               capability_run_id AS capabilityRunId,
               capability_attempt_id AS capabilityAttemptId,
               pricing_revision_id AS pricingRevisionId,
               currency_code AS currencyCode,
               reserved_amount AS reservedAmount,
               settled_amount AS settledAmount,
               unknown_hold_amount AS unknownHoldAmount,
               lifecycle_status AS lifecycleStatus,
               expires_at AS expiresAt,
               version,
               settled_at AS settledAt
             FROM budget_reservation
             WHERE workspace_id = ?
               AND budget_account_id = ?
               AND id = ?
             LIMIT 1
             FOR UPDATE`,
          [options.workspaceId, options.budgetAccountId, options.reservationId],
        );
        const reservation = reservationRows[0];
        if (!reservation) {
          return fail("budget.not_found", "Budget reservation does not exist.");
        }
        if (reservation.requestDigest !== options.requestDigest) {
          return fail(
            "budget.identity_conflict",
            "Finalization request digest differs from the reservation.",
          );
        }
        const captured =
          options.kind === "capture"
            ? decimalToUnits(options.capturedAmount, "capturedAmount")
            : 0n;
        const reserved = decimalToUnits(
          reservation.reservedAmount,
          "reservedAmount",
        );
        if (captured > reserved) {
          return fail(
            "budget.identity_conflict",
            "Captured amount exceeds the reserved maximum charge.",
          );
        }
        if (
          options.kind === "expire" &&
          options.now.getTime() < reservation.expiresAt.getTime()
        ) {
          return fail(
            "budget.lifecycle_conflict",
            "A reservation cannot expire before its deadline.",
          );
        }
        const expectedLifecycle = finalizationLifecycle(options.kind);
        const existingLedger = await loadLedgerByKey(
          connection,
          account.id,
          options.ledgerEntryKey,
        );
        if (reservation.lifecycleStatus === expectedLifecycle) {
          const expectedKind = finalizationLedgerKind(options.kind);
          const exactReplay =
            existingLedger !== undefined &&
            existingLedger.entryKind === expectedKind &&
            existingLedger.budgetReservationId === reservation.id &&
            existingLedger.currencyCode === reservation.currencyCode &&
            existingLedger.requestDigest === options.requestDigest &&
            signedDecimalToUnits(existingLedger.reservedDelta) === -reserved &&
            signedDecimalToUnits(existingLedger.consumedDelta) === captured &&
            signedDecimalToUnits(existingLedger.unknownHeldDelta) ===
              (options.kind === "unknown_hold" ? reserved : 0n) &&
            (options.kind !== "capture" ||
              (reservation.settledAmount !== null &&
                decimalToUnits(reservation.settledAmount) === captured));
          if (!exactReplay) {
            return fail(
              "budget.identity_conflict",
              "Terminal reservation replay differs from durable ledger facts.",
            );
          }
          return Object.freeze({
            status: "replayed",
            reservationId: reservation.id,
            lifecycleStatus: expectedLifecycle,
            settledAmount:
              reservation.settledAmount === null
                ? null
                : normalizeUnsignedDecimal(reservation.settledAmount),
            unknownHoldAmount:
              reservation.unknownHoldAmount === null
                ? null
                : normalizeUnsignedDecimal(reservation.unknownHoldAmount),
            accountVersion: account.version,
          });
        }
        if (reservation.lifecycleStatus !== "reserved") {
          return fail(
            "budget.lifecycle_conflict",
            "Only a reserved budget hold can be finalized.",
          );
        }
        if (existingLedger) {
          return fail(
            "budget.identity_conflict",
            "Ledger entry key already belongs to another finalization.",
          );
        }

        const before = accountUnits(account);
        if (before.reserved < reserved) {
          return fail(
            "budget.account_corrupt",
            "Account reserved balance is below the reservation.",
          );
        }
        const reservedAfter = before.reserved - reserved;
        const consumedAfter = before.consumed + captured;
        const unknownAfter =
          before.unknown + (options.kind === "unknown_hold" ? reserved : 0n);
        const totalAfter = consumedAfter + reservedAfter + unknownAfter;
        if (totalAfter > before.hard) {
          return fail(
            "budget.account_corrupt",
            "Finalized balances would exceed the hard limit.",
          );
        }
        const accountVersion = account.version + 1;
        const [accountResult] = await connection.execute<ResultSetHeader>(
          `UPDATE budget_account
             SET reserved_amount = ?,
                 consumed_amount = ?,
                 unknown_held_amount = ?,
                 lifecycle_status = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?
               AND consumed_amount = ?
               AND reserved_amount = ?
               AND unknown_held_amount = ?`,
          [
            decimalUnitsToString(reservedAfter),
            decimalUnitsToString(consumedAfter),
            decimalUnitsToString(unknownAfter),
            nextAccountLifecycle(
              account.lifecycleStatus,
              totalAfter,
              before.hard,
            ),
            options.now,
            options.workspaceId,
            account.id,
            account.version,
            account.consumedAmount,
            account.reservedAmount,
            account.unknownHeldAmount,
          ],
        );
        if (accountResult.affectedRows !== 1) {
          return fail(
            "budget.identity_conflict",
            "Budget finalization lost its account compare-and-swap.",
          );
        }
        const settledAmount =
          options.kind === "capture" ? decimalUnitsToString(captured) : null;
        const [reservationResult] = await connection.execute<ResultSetHeader>(
          `UPDATE budget_reservation
             SET lifecycle_status = ?,
                 settled_amount = ?,
                 unknown_hold_amount = ?,
                 settled_at = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND budget_account_id = ?
               AND id = ?
               AND lifecycle_status = 'reserved'
               AND version = ?`,
          [
            expectedLifecycle,
            settledAmount,
            options.kind === "unknown_hold"
              ? decimalUnitsToString(reserved)
              : null,
            options.now,
            options.now,
            options.workspaceId,
            account.id,
            reservation.id,
            reservation.version,
          ],
        );
        if (reservationResult.affectedRows !== 1) {
          return fail(
            "budget.identity_conflict",
            "Budget finalization lost its reservation compare-and-swap.",
          );
        }
        const ledgerKind = finalizationLedgerKind(options.kind);
        await connection.execute<ResultSetHeader>(
          `INSERT INTO budget_ledger_entry (
             id,
             workspace_id,
             budget_account_id,
             budget_reservation_id,
             entry_key,
             entry_kind,
             currency_code,
             reserved_delta,
             consumed_delta,
             unknown_held_delta,
             reserved_balance_after,
             consumed_balance_after,
             unknown_held_balance_after,
             request_digest,
             evidence,
             corrects_entry_id,
             created_by_principal_id,
             occurred_at,
             recorded_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             NULL, ?, ?, ?
           )`,
          [
            options.ledgerEntryId,
            options.workspaceId,
            account.id,
            reservation.id,
            options.ledgerEntryKey,
            ledgerKind,
            reservation.currencyCode,
            decimalUnitsToString(-reserved),
            decimalUnitsToString(captured),
            options.kind === "unknown_hold"
              ? decimalUnitsToString(reserved)
              : "0",
            decimalUnitsToString(reservedAfter),
            decimalUnitsToString(consumedAfter),
            decimalUnitsToString(unknownAfter),
            options.requestDigest,
            canonicalizeProviderValue({
              schemaVersion: 1,
              operation: options.kind,
              reservationVersionBefore: reservation.version,
              reservationVersionAfter: reservation.version + 1,
            }),
            options.audit.actorPrincipalId,
            options.now,
            options.now,
          ],
        );
        await appendBudgetAudit(connection, account, options.audit, {
          eventType: `budget_reservation.${options.kind}`,
          action: options.kind,
          resourceId: reservation.id,
          outcome: "succeeded",
          decisionReasonCode: `budget.${options.kind}`,
          details: {
            currencyCode: reservation.currencyCode,
            releasedAmount: decimalUnitsToString(reserved),
            capturedAmount: decimalUnitsToString(captured),
            accountVersionBefore: account.version,
            accountVersionAfter: accountVersion,
          },
          now: options.now,
        });
        return Object.freeze({
          status: "finalized",
          reservationId: reservation.id,
          lifecycleStatus: expectedLifecycle,
          settledAmount,
          unknownHoldAmount:
            options.kind === "unknown_hold"
              ? decimalUnitsToString(reserved)
              : null,
          accountVersion,
        });
      });
    },

    async resolveUnknown(
      options: ResolveUnknownBudgetHoldCommand,
    ): Promise<UnknownBudgetHoldResolutionResult> {
      assertResolveUnknownOptions(options);
      return inTransaction(pool, async (connection) => {
        const workspaceId =
          "scope" in options ? options.scope.workspaceId : options.workspaceId;
        if ("scope" in options) {
          await revalidateTrustedWorkspaceScopeInTransaction(
            connection,
            options.scope,
            "credential.manage",
            options.now,
          );
        } else if (
          options.audit.actorType !== "system" ||
          options.audit.actorPrincipalId !== null
        ) {
          invalid("System unknown resolution requires system audit authority.");
        }
        const [accountRows] = await connection.execute<ReservationAccountRow[]>(
          `SELECT
               budget_account_id AS budgetAccountId
             FROM budget_reservation
             WHERE workspace_id = ?
               AND id = ?
             LIMIT 1`,
          [workspaceId, options.reservationId],
        );
        const accountIdentity = accountRows[0];
        if (!accountIdentity) {
          return fail(
            "budget.not_found",
            "Unknown budget hold does not exist.",
          );
        }
        const account = await lockAccount(
          connection,
          workspaceId,
          accountIdentity.budgetAccountId,
        );
        const [reservationRows] = await connection.execute<
          BudgetReservationRow[]
        >(
          `SELECT
               id,
               workspace_id AS workspaceId,
               budget_account_id AS budgetAccountId,
               reservation_key AS reservationKey,
               request_digest AS requestDigest,
               workflow_run_id AS workflowRunId,
               capability_run_id AS capabilityRunId,
               capability_attempt_id AS capabilityAttemptId,
               pricing_revision_id AS pricingRevisionId,
               currency_code AS currencyCode,
               reserved_amount AS reservedAmount,
               settled_amount AS settledAmount,
               unknown_hold_amount AS unknownHoldAmount,
               lifecycle_status AS lifecycleStatus,
               expires_at AS expiresAt,
               version,
               settled_at AS settledAt
             FROM budget_reservation
             WHERE workspace_id = ?
               AND budget_account_id = ?
               AND id = ?
             LIMIT 1
             FOR UPDATE`,
          [workspaceId, account.id, options.reservationId],
        );
        const reservation = reservationRows[0];
        if (!reservation) {
          return fail(
            "budget.not_found",
            "Unknown budget hold does not exist.",
          );
        }
        const existingLedger = await loadLedgerByKey(
          connection,
          account.id,
          options.ledgerEntryKey,
        );
        const expectedLifecycle =
          options.resolution === "charged" ? "settled" : "released";
        if (
          reservation.lifecycleStatus === expectedLifecycle &&
          existingLedger?.entryKind === "unknown_resolve" &&
          existingLedger.budgetReservationId === reservation.id &&
          existingLedger.requestDigest === options.requestDigest
        ) {
          return Object.freeze({
            status: "replayed",
            reservationId: reservation.id,
            lifecycleStatus: expectedLifecycle,
            chargedAmount: normalizeUnsignedDecimal(
              existingLedger.consumedDelta,
            ),
            resolvedAt: new Date(existingLedger.occurredAt),
            accountVersion: account.version,
          });
        }
        if (reservation.lifecycleStatus !== "unknown") {
          return fail(
            "budget.lifecycle_conflict",
            "Only an unknown budget hold can be resolved.",
          );
        }
        if (reservation.version !== options.expectedVersion) {
          return fail(
            "budget.identity_conflict",
            "Unknown budget hold changed before resolution.",
          );
        }
        if (existingLedger) {
          return fail(
            "budget.identity_conflict",
            "Ledger entry key already belongs to another resolution.",
          );
        }
        if (reservation.unknownHoldAmount === null) {
          return fail(
            "budget.account_corrupt",
            "Unknown reservation is missing its held amount.",
          );
        }
        const held = decimalToUnits(
          reservation.unknownHoldAmount,
          "unknownHoldAmount",
        );
        const charged =
          options.resolution === "charged"
            ? decimalToUnits(options.chargedAmount, "chargedAmount")
            : 0n;
        if (charged > held) {
          return fail(
            "budget.identity_conflict",
            "Confirmed charge exceeds the unknown held maximum.",
          );
        }
        const before = accountUnits(account);
        if (before.unknown < held) {
          return fail(
            "budget.account_corrupt",
            "Account unknown balance is below the reservation.",
          );
        }
        const consumedAfter = before.consumed + charged;
        const unknownAfter = before.unknown - held;
        const totalAfter = consumedAfter + before.reserved + unknownAfter;
        if (totalAfter > before.hard) {
          return fail(
            "budget.account_corrupt",
            "Resolved balances would exceed the hard limit.",
          );
        }
        const accountVersion = account.version + 1;
        const [accountResult] = await connection.execute<ResultSetHeader>(
          `UPDATE budget_account
             SET consumed_amount = ?,
                 unknown_held_amount = ?,
                 lifecycle_status = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?
               AND consumed_amount = ?
               AND reserved_amount = ?
               AND unknown_held_amount = ?`,
          [
            decimalUnitsToString(consumedAfter),
            decimalUnitsToString(unknownAfter),
            nextAccountLifecycle(
              account.lifecycleStatus,
              totalAfter,
              before.hard,
            ),
            options.now,
            workspaceId,
            account.id,
            account.version,
            account.consumedAmount,
            account.reservedAmount,
            account.unknownHeldAmount,
          ],
        );
        if (accountResult.affectedRows !== 1) {
          return fail(
            "budget.identity_conflict",
            "Unknown resolution lost its account compare-and-swap.",
          );
        }
        const chargedAmount = decimalUnitsToString(charged);
        const [reservationResult] = await connection.execute<ResultSetHeader>(
          `UPDATE budget_reservation
             SET lifecycle_status = ?,
                 settled_amount = ?,
                 unknown_hold_amount = NULL,
                 settled_at = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND budget_account_id = ?
               AND id = ?
               AND lifecycle_status = 'unknown'
               AND version = ?`,
          [
            expectedLifecycle,
            options.resolution === "charged" ? chargedAmount : null,
            options.now,
            options.now,
            workspaceId,
            account.id,
            reservation.id,
            reservation.version,
          ],
        );
        if (reservationResult.affectedRows !== 1) {
          return fail(
            "budget.identity_conflict",
            "Unknown resolution lost its reservation compare-and-swap.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO budget_ledger_entry (
             id,
             workspace_id,
             budget_account_id,
             budget_reservation_id,
             entry_key,
             entry_kind,
             currency_code,
             reserved_delta,
             consumed_delta,
             unknown_held_delta,
             reserved_balance_after,
             consumed_balance_after,
             unknown_held_balance_after,
             request_digest,
             evidence,
             corrects_entry_id,
             created_by_principal_id,
             occurred_at,
             recorded_at
           ) VALUES (
             ?, ?, ?, ?, ?, 'unknown_resolve', ?, 0, ?, ?, ?, ?, ?,
             ?, ?, NULL, ?, ?, ?
           )`,
          [
            options.ledgerEntryId,
            workspaceId,
            account.id,
            reservation.id,
            options.ledgerEntryKey,
            reservation.currencyCode,
            chargedAmount,
            decimalUnitsToString(-held),
            decimalUnitsToString(before.reserved),
            decimalUnitsToString(consumedAfter),
            decimalUnitsToString(unknownAfter),
            options.requestDigest,
            canonicalizeProviderValue({
              schemaVersion: 1,
              operation: "unknown_resolve",
              resolution: options.resolution,
              evidenceReference: options.evidenceReference.trim(),
              reservationVersionBefore: reservation.version,
              reservationVersionAfter: reservation.version + 1,
            }),
            options.audit.actorPrincipalId,
            options.now,
            options.now,
          ],
        );
        await appendBudgetAudit(connection, account, options.audit, {
          eventType: "budget_reservation.unknown_resolve",
          action: "unknown_resolve",
          resourceId: reservation.id,
          outcome: "succeeded",
          decisionReasonCode:
            options.resolution === "charged"
              ? "budget.unknown_resolved_charged"
              : "budget.unknown_resolved_not_charged",
          details: {
            currencyCode: reservation.currencyCode,
            unknownAmount: decimalUnitsToString(held),
            chargedAmount,
            evidenceReference: options.evidenceReference.trim(),
            accountVersionBefore: account.version,
            accountVersionAfter: accountVersion,
          },
          now: options.now,
        });
        return Object.freeze({
          status: "resolved",
          reservationId: reservation.id,
          lifecycleStatus: expectedLifecycle,
          chargedAmount,
          resolvedAt: new Date(options.now),
          accountVersion,
        });
      });
    },
  });
}
