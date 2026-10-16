import { parseProviderReportedCharge } from "@kanvas/application";
import { digestProviderValue } from "./provider-value-digest.js";
import type { Pool, RowDataPacket } from "mysql2/promise";

import { normalizeUnsignedDecimal } from "./fixed-decimal.js";

const maximumBatchSize = 100;

export type ProviderTerminalBudgetStatus =
  "unknown" | "succeeded" | "failed" | "cancelled" | "not_found";

export interface ProviderBudgetSettlementCandidate {
  readonly workspaceId: string;
  readonly invocationId: string;
  readonly budgetAccountId: string;
  readonly reservationId: string;
  readonly requestDigest: string;
  readonly remoteStatus: ProviderTerminalBudgetStatus;
  readonly sideEffectState: "not_started" | "started" | "committed" | "unknown";
  readonly reservationLifecycle: "reserved" | "unknown";
  readonly reservationVersion: number;
}

export interface ScanProviderBudgetSettlementsOptions {
  readonly batchSize: number;
}

export interface ProviderBudgetSettlementUsageMetric {
  readonly metricKey: string;
  readonly numericValue: string;
  readonly unitCode: string;
}

export interface ProviderBudgetSettlementEvidence {
  readonly pricingDocument: Readonly<Record<string, unknown>>;
  readonly currencyCode: string;
  readonly maximumChargeAmount: string;
  readonly usage: readonly ProviderBudgetSettlementUsageMetric[];
  readonly reportedCharge?: {
    readonly currencyCode: string;
    readonly amount: string;
  };
}

export interface AgentBudgetSettlementCandidate {
  readonly workspaceId: string;
  readonly modelCallId: string;
  readonly budgetAccountId: string;
  readonly reservationId: string;
  readonly requestDigest: string;
  readonly attemptStatus: "succeeded" | "failed" | "cancelled" | "unknown";
  readonly pricingDocument: Readonly<Record<string, unknown>>;
  readonly currencyCode: string;
  readonly maximumChargeAmount: string;
  readonly usageDocument?: Readonly<Record<string, unknown>>;
}

export interface ProviderBudgetSettlementStore {
  scanPending(
    options: ScanProviderBudgetSettlementsOptions,
  ): Promise<readonly ProviderBudgetSettlementCandidate[]>;
  loadEvidence(
    candidate: ProviderBudgetSettlementCandidate,
  ): Promise<ProviderBudgetSettlementEvidence>;
  scanAgentPending(
    options: ScanProviderBudgetSettlementsOptions,
  ): Promise<readonly AgentBudgetSettlementCandidate[]>;
}

interface SettlementRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly invocationId: string;
  readonly invocationAttemptId: string;
  readonly invocationPricingRevisionId: string;
  readonly invocationBudgetReservationId: string;
  readonly remoteStatus: ProviderTerminalBudgetStatus;
  readonly sideEffectState: "not_started" | "started" | "committed" | "unknown";
  readonly reservationLifecycle: "reserved" | "unknown";
  readonly reservationVersion: number;
  readonly budgetAccountId: string;
  readonly reservationId: string;
  readonly reservationAttemptId: string;
  readonly reservationPricingRevisionId: string;
  readonly requestDigest: string;
}

interface PricingEvidenceRow extends RowDataPacket {
  readonly resultFacts?: unknown;
  readonly pricingDocument: unknown;
  readonly currencyCode: string;
  readonly maximumChargeAmount: string;
}

interface UsageEvidenceRow extends RowDataPacket {
  readonly metricKey: string;
  readonly valueDimension: "quantity" | "money";
  readonly unitCode: string | null;
  readonly numericValue: string | null;
  readonly currencyCode: string | null;
}

interface AgentSettlementRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly modelCallId: string;
  readonly budgetAccountId: string;
  readonly reservationId: string;
  readonly requestDigest: string;
  readonly attemptStatus: "succeeded" | "failed" | "cancelled" | "unknown";
  readonly pricingDocument: unknown;
  readonly currencyCode: string;
  readonly maximumChargeAmount: string;
  readonly usageDocument: unknown;
}

function objectDocument(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch (error) {
      throw new Error(`${label} is invalid JSON.`, { cause: error });
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be an object.`);
  }
  return parsed as Readonly<Record<string, unknown>>;
}

export function createProviderBudgetSettlementStore(
  pool: Pool,
): ProviderBudgetSettlementStore {
  const confirmedResult = `EXISTS (SELECT 1 FROM provider_invocation_observation AS observed
    WHERE observed.provider_invocation_id = invocation.id AND observed.workspace_id = invocation.workspace_id
      AND observed.result_facts IS NOT NULL AND observed.normalized_status = 'succeeded' AND observed.adoption_outcome = 'applied')`;
  return Object.freeze({
    async scanPending(
      options: ScanProviderBudgetSettlementsOptions,
    ): Promise<readonly ProviderBudgetSettlementCandidate[]> {
      if (
        !Number.isSafeInteger(options.batchSize) ||
        options.batchSize < 1 ||
        options.batchSize > maximumBatchSize
      ) {
        throw new RangeError(
          "Provider budget settlement batchSize must be between 1 and 100.",
        );
      }
      const [rows] = await pool.execute<SettlementRow[]>(
        `SELECT
           invocation.workspace_id AS workspaceId,
           invocation.id AS invocationId,
           invocation.capability_attempt_id AS invocationAttemptId,
           invocation.pricing_revision_id
             AS invocationPricingRevisionId,
           invocation.budget_reservation_id
             AS invocationBudgetReservationId,
           CASE WHEN ${confirmedResult} THEN 'succeeded' ELSE invocation.remote_status END AS remoteStatus,
           CASE WHEN ${confirmedResult} THEN 'committed' ELSE invocation.side_effect_state END AS sideEffectState,
           reservation.lifecycle_status AS reservationLifecycle,
           reservation.version AS reservationVersion,
           reservation.budget_account_id AS budgetAccountId,
           reservation.id AS reservationId,
           reservation.capability_attempt_id
             AS reservationAttemptId,
           reservation.pricing_revision_id
             AS reservationPricingRevisionId,
           reservation.request_digest AS requestDigest
         FROM provider_invocation AS invocation
         INNER JOIN budget_reservation AS reservation
           ON reservation.workspace_id = invocation.workspace_id
          AND reservation.id =
                invocation.budget_reservation_id
         WHERE (
             reservation.lifecycle_status = 'reserved'
             AND (
               ${confirmedResult} OR (
                 invocation.work_state = 'terminal'
                 AND invocation.remote_status IN (
                   'succeeded', 'failed', 'cancelled', 'not_found'
                 )
               )
               OR (
                 invocation.work_state = 'manual'
                 AND invocation.remote_status = 'unknown'
                 AND reservation.expires_at <= CURRENT_TIMESTAMP(3)
               )
             )
           ) OR (
             reservation.lifecycle_status = 'unknown'
             AND (invocation.side_effect_state = 'not_started' OR EXISTS (
               SELECT 1 FROM provider_invocation_observation AS observed
               WHERE observed.provider_invocation_id = invocation.id AND observed.workspace_id = invocation.workspace_id
                 AND observed.normalized_status = 'succeeded' AND observed.adoption_outcome = 'applied'
                 AND JSON_EXTRACT(observed.result_facts, '$.reportedCharge') IS NOT NULL))
           )
         ORDER BY invocation.terminal_at ASC, invocation.id ASC
         LIMIT ${String(options.batchSize)}`,
      );
      return Object.freeze(
        rows.map((row) => {
          if (
            row.invocationBudgetReservationId !== row.reservationId ||
            row.invocationAttemptId !== row.reservationAttemptId ||
            row.invocationPricingRevisionId !== row.reservationPricingRevisionId
          ) {
            throw new Error(
              "Provider terminal invocation has inconsistent budget settlement pins.",
            );
          }
          return Object.freeze({
            workspaceId: row.workspaceId,
            invocationId: row.invocationId,
            budgetAccountId: row.budgetAccountId,
            reservationId: row.reservationId,
            requestDigest: row.requestDigest,
            remoteStatus: row.remoteStatus,
            sideEffectState: row.sideEffectState,
            reservationLifecycle: row.reservationLifecycle,
            reservationVersion: row.reservationVersion,
          });
        }),
      );
    },

    async loadEvidence(
      candidate: ProviderBudgetSettlementCandidate,
    ): Promise<ProviderBudgetSettlementEvidence> {
      const [pricingRows] = await pool.execute<PricingEvidenceRow[]>(
        `SELECT
           pricing.pricing_document AS pricingDocument,
           pricing.currency_code AS currencyCode,
           reservation.reserved_amount AS maximumChargeAmount,
           (SELECT JSON_ARRAYAGG(JSON_OBJECT('facts', observed.result_facts, 'digest', observed.response_digest))
            FROM provider_invocation_observation AS observed WHERE observed.provider_invocation_id = invocation.id
              AND observed.workspace_id = invocation.workspace_id AND observed.result_facts IS NOT NULL
              AND observed.normalized_status = 'succeeded' AND observed.adoption_outcome = 'applied') AS resultFacts
         FROM provider_invocation AS invocation
         INNER JOIN budget_reservation AS reservation
           ON reservation.workspace_id = invocation.workspace_id
          AND reservation.id = invocation.budget_reservation_id
         INNER JOIN pricing_revision AS pricing
           ON pricing.workspace_id = invocation.workspace_id
          AND pricing.id = invocation.pricing_revision_id
          AND pricing.id = reservation.pricing_revision_id
         WHERE invocation.workspace_id = ?
           AND invocation.id = ?
           AND reservation.id = ?
           AND reservation.budget_account_id = ?
         LIMIT 1`,
        [
          candidate.workspaceId,
          candidate.invocationId,
          candidate.reservationId,
          candidate.budgetAccountId,
        ],
      );
      const pricing = pricingRows[0];
      if (!pricing) {
        throw new Error("Provider settlement evidence lost its pricing pins.");
      }
      const [usageRows] = await pool.execute<UsageEvidenceRow[]>(
        `SELECT
           metric_key AS metricKey,
           value_dimension AS valueDimension,
           unit_code AS unitCode,
           numeric_value AS numericValue,
           currency_code AS currencyCode
         FROM usage_ledger_entry
         WHERE workspace_id = ?
           AND provider_invocation_id = ?
           AND pricing_revision_id = (
             SELECT pricing_revision_id
             FROM provider_invocation
             WHERE workspace_id = ? AND id = ?
             LIMIT 1
           )
           AND entry_kind = 'observation'
           AND corrects_usage_entry_id IS NULL
         ORDER BY entry_key`,
        [
          candidate.workspaceId,
          candidate.invocationId,
          candidate.workspaceId,
          candidate.invocationId,
        ],
      );
      const usage: ProviderBudgetSettlementUsageMetric[] = [];
      let reportedCharge:
        { readonly currencyCode: string; readonly amount: string } | undefined;
      for (const row of usageRows) {
        if (row.numericValue === null) {
          throw new Error("Provider settlement Usage lost its numeric value.");
        }
        const numericValue = normalizeUnsignedDecimal(
          row.numericValue,
          `usage.${row.metricKey}`,
        );
        if (row.valueDimension === "money") {
          if (
            row.metricKey !== "provider_reported_charge" ||
            !row.currencyCode ||
            reportedCharge
          ) {
            throw new Error(
              "Provider settlement reported charge evidence is ambiguous.",
            );
          }
          reportedCharge = Object.freeze({
            currencyCode: row.currencyCode,
            amount: numericValue,
          });
          continue;
        }
        if (!row.unitCode || !/^(?:0|[1-9][0-9]*)$/u.test(numericValue)) {
          throw new Error(
            "Provider settlement quantity Usage is not a canonical integer.",
          );
        }
        usage.push(
          Object.freeze({
            metricKey: row.metricKey,
            numericValue,
            unitCode: row.unitCode,
          }),
        );
      }
      const rawFacts: unknown = pricing.resultFacts;
      const snapshots: unknown =
        typeof rawFacts === "string"
          ? (JSON.parse(rawFacts) as unknown)
          : rawFacts;
      if (
        snapshots !== undefined &&
        snapshots !== null &&
        !Array.isArray(snapshots)
      )
        throw new Error("Invalid Provider result evidence.");
      for (const snapshot of (snapshots ?? []) as readonly unknown[]) {
        const envelope = objectDocument(snapshot, "Provider result evidence");
        const facts = objectDocument(envelope.facts, "Provider result facts");
        if (
          facts.schemaVersion !== 1 ||
          digestProviderValue(facts) !== envelope.digest ||
          !Array.isArray(facts.usage)
        )
          throw new Error("Invalid Provider result evidence digest.");
        if (facts.reportedCharge) {
          const charge = parseProviderReportedCharge(facts.reportedCharge);
          const amount = normalizeUnsignedDecimal(
            charge.amount,
            "reported charge",
          );
          if (
            reportedCharge &&
            (reportedCharge.currencyCode !== charge.currencyCode ||
              reportedCharge.amount !== amount)
          )
            throw new Error("Conflicting Provider reported charge evidence.");
          reportedCharge = { currencyCode: charge.currencyCode, amount };
        }
        for (const rawMetric of facts.usage) {
          const metric = objectDocument(rawMetric, "Provider result usage");
          if (
            typeof metric.metricKey !== "string" ||
            typeof metric.unitCode !== "string" ||
            typeof metric.numericValue !== "string"
          )
            throw new Error("Invalid Provider result usage.");
          const numericValue = normalizeUnsignedDecimal(
            metric.numericValue,
            "Provider result usage",
          );
          const previous = usage.find(
            (item) => item.metricKey === metric.metricKey,
          );
          if (
            previous &&
            (previous.unitCode !== metric.unitCode ||
              previous.numericValue !== numericValue)
          )
            throw new Error("Conflicting Provider usage evidence.");
          if (!previous)
            usage.push({
              metricKey: metric.metricKey,
              unitCode: metric.unitCode,
              numericValue,
            });
        }
      }
      return Object.freeze({
        pricingDocument: objectDocument(
          pricing.pricingDocument,
          "Provider settlement pricing",
        ),
        currencyCode: pricing.currencyCode,
        maximumChargeAmount: normalizeUnsignedDecimal(
          pricing.maximumChargeAmount,
          "maximumChargeAmount",
        ),
        usage: Object.freeze(usage),
        ...(reportedCharge ? { reportedCharge } : {}),
      });
    },

    async scanAgentPending(
      options: ScanProviderBudgetSettlementsOptions,
    ): Promise<readonly AgentBudgetSettlementCandidate[]> {
      if (
        !Number.isSafeInteger(options.batchSize) ||
        options.batchSize < 1 ||
        options.batchSize > maximumBatchSize
      ) {
        throw new RangeError(
          "Agent budget settlement batchSize must be between 1 and 100.",
        );
      }
      const [rows] = await pool.execute<AgentSettlementRow[]>(
        `SELECT
           reservation.workspace_id AS workspaceId,
           model_call.id AS modelCallId,
           reservation.budget_account_id AS budgetAccountId,
           reservation.id AS reservationId,
           reservation.request_digest AS requestDigest,
           attempt.lifecycle_status AS attemptStatus,
           pricing.pricing_document AS pricingDocument,
           pricing.currency_code AS currencyCode,
           reservation.reserved_amount AS maximumChargeAmount,
           attempt.usage_document AS usageDocument
         FROM budget_reservation AS reservation
         INNER JOIN agent_model_call AS model_call
           ON model_call.workspace_id = reservation.workspace_id
          AND model_call.id = reservation.agent_model_call_id
         INNER JOIN agent_model_attempt AS attempt
           ON attempt.workspace_id = model_call.workspace_id
          AND attempt.agent_model_call_id = model_call.id
          AND attempt.attempt_number = (
            SELECT MAX(latest_attempt.attempt_number)
            FROM agent_model_attempt AS latest_attempt
            WHERE latest_attempt.workspace_id = model_call.workspace_id
              AND latest_attempt.agent_model_call_id = model_call.id
          )
         INNER JOIN pricing_revision AS pricing
           ON pricing.workspace_id = reservation.workspace_id
          AND pricing.id = reservation.pricing_revision_id
         WHERE reservation.lifecycle_status = 'reserved'
           AND model_call.lifecycle_status IN (
             'succeeded', 'failed', 'cancelled'
           )
           AND attempt.lifecycle_status IN (
             'succeeded', 'failed', 'cancelled', 'unknown'
           )
           AND attempt.completed_at IS NOT NULL
         ORDER BY attempt.completed_at ASC, reservation.id ASC
         LIMIT ${String(options.batchSize)}`,
      );
      return Object.freeze(
        rows.map((row) =>
          Object.freeze({
            workspaceId: row.workspaceId,
            modelCallId: row.modelCallId,
            budgetAccountId: row.budgetAccountId,
            reservationId: row.reservationId,
            requestDigest: row.requestDigest,
            attemptStatus: row.attemptStatus,
            pricingDocument: objectDocument(
              row.pricingDocument,
              "Agent settlement pricing",
            ),
            currencyCode: row.currencyCode,
            maximumChargeAmount: normalizeUnsignedDecimal(
              row.maximumChargeAmount,
              "maximumChargeAmount",
            ),
            ...(row.usageDocument === null
              ? {}
              : {
                  usageDocument: objectDocument(
                    row.usageDocument,
                    "Agent settlement Usage",
                  ),
                }),
          }),
        ),
      );
    },
  });
}
