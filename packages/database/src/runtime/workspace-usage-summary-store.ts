import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { decimalToUnits } from "./fixed-decimal.js";

export interface WorkspaceBudgetSummaryRecord {
  readonly name: string;
  readonly providerSettingId?: string;
  readonly status: "active" | "frozen" | "exhausted" | "closed";
  readonly currencyCode: string;
  readonly periodStartAt: Date;
  readonly periodEndAt: Date;
  readonly hardLimitAmount: string;
  readonly consumedAmount: string;
  readonly reservedAmount: string;
  readonly unknownHeldAmount: string;
  readonly remainingAmount: string;
  readonly version: number;
}

export type WorkspaceUsageMetricRecord =
  | {
      readonly metricKey: string;
      readonly dimension: "quantity";
      readonly unitCode: string;
      readonly value: string;
      readonly unknownCount: number;
      readonly lastRecordedAt: Date;
    }
  | {
      readonly metricKey: string;
      readonly dimension: "money";
      readonly currencyCode: string;
      readonly value: string;
      readonly unknownCount: number;
      readonly lastRecordedAt: Date;
    };

export interface WorkspaceUsageSummaryRecord {
  readonly trackedAttemptCount: number;
  readonly unknownUsageCount: number;
  readonly budgets: readonly WorkspaceBudgetSummaryRecord[];
  readonly unknownHolds: readonly WorkspaceUnknownBudgetHoldRecord[];
  readonly metrics: readonly WorkspaceUsageMetricRecord[];
}

export interface WorkspaceUnknownBudgetHoldRecord {
  readonly id: string;
  readonly providerName: string;
  readonly workflowRunId?: string;
  readonly capabilityRunId?: string;
  readonly providerRequestId?: string;
  readonly currencyCode: string;
  readonly heldAmount: string;
  readonly version: number;
  readonly submittedAt?: Date;
  readonly heldAt: Date;
}

export interface WorkspaceUsageSummaryStore {
  get(
    scope: TrustedWorkspaceScope,
    windowStartAt: Date,
    now: Date,
  ): Promise<WorkspaceUsageSummaryRecord>;
  updateBudgetLimit(
    options: UpdateWorkspaceBudgetLimitOptions,
  ): Promise<WorkspaceBudgetMutationRecord>;
}

export interface UpdateWorkspaceBudgetLimitOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly providerSettingId: string;
  readonly expectedVersion: number;
  readonly hardLimitAmount: string;
  readonly now: Date;
}

export interface WorkspaceBudgetMutationRecord {
  readonly providerSettingId: string;
  readonly hardLimitAmount: string;
  readonly version: number;
  readonly updatedAt: Date;
}

interface BudgetRow extends RowDataPacket {
  readonly name: string;
  readonly providerSettingId: string | null;
  readonly status: WorkspaceBudgetSummaryRecord["status"];
  readonly currencyCode: string;
  readonly periodStartAt: Date;
  readonly periodEndAt: Date;
  readonly hardLimitAmount: string;
  readonly consumedAmount: string;
  readonly reservedAmount: string;
  readonly unknownHeldAmount: string;
  readonly remainingAmount: string;
  readonly version: number;
}

interface BudgetLimitRow extends RowDataPacket {
  readonly id: string;
  readonly hardLimitAmount: string;
  readonly consumedAmount: string;
  readonly reservedAmount: string;
  readonly unknownHeldAmount: string;
  readonly lifecycleStatus: "active" | "frozen" | "exhausted" | "closed";
  readonly version: number;
}

export class WorkspaceUsageSummaryStoreError extends Error {
  public constructor(
    public readonly code:
      | "budget.limit_below_committed"
      | "budget.not_found"
      | "budget.version_conflict",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceUsageSummaryStoreError";
  }
}

interface UsageOverviewRow extends RowDataPacket {
  readonly trackedAttemptCount: number | string;
  readonly unknownUsageCount: number | string;
}

interface UnknownBudgetHoldRow extends RowDataPacket {
  readonly id: string;
  readonly providerName: string;
  readonly workflowRunId: string | null;
  readonly capabilityRunId: string | null;
  readonly providerRequestId: string | null;
  readonly currencyCode: string;
  readonly heldAmount: string;
  readonly version: number;
  readonly submittedAt: Date | null;
  readonly heldAt: Date;
}

interface UsageMetricRow extends RowDataPacket {
  readonly metricKey: string;
  readonly dimension: "quantity" | "money";
  readonly unitCode: string | null;
  readonly currencyCode: string | null;
  readonly value: string;
  readonly unknownCount: number | string;
  readonly lastRecordedAt: Date;
}

async function inTransaction<TResult>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function metricFrom(row: UsageMetricRow): WorkspaceUsageMetricRecord {
  const common = {
    metricKey: row.metricKey,
    value: row.value,
    unknownCount: Number(row.unknownCount),
    lastRecordedAt: new Date(row.lastRecordedAt),
  };
  if (row.dimension === "quantity" && row.unitCode) {
    return Object.freeze({
      ...common,
      dimension: "quantity" as const,
      unitCode: row.unitCode,
    });
  }
  if (row.dimension === "money" && row.currencyCode) {
    return Object.freeze({
      ...common,
      dimension: "money" as const,
      currencyCode: row.currencyCode,
    });
  }
  throw new Error("Workspace usage metric has an invalid dimension.");
}

export function createWorkspaceUsageSummaryStore(
  pool: Pool,
): WorkspaceUsageSummaryStore {
  return Object.freeze({
    async get(
      scope: TrustedWorkspaceScope,
      windowStartAt: Date,
      now: Date,
    ): Promise<WorkspaceUsageSummaryRecord> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "usage.read",
          now,
        );
        const [budgetRows] = await connection.execute<BudgetRow[]>(
          `SELECT
               COALESCE(
                 setting.display_name,
                 '团队共享额度'
               ) AS name,
               setting.id AS providerSettingId,
               account.lifecycle_status AS status,
               account.currency_code AS currencyCode,
               account.period_start_at AS periodStartAt,
               account.period_end_at AS periodEndAt,
               CAST(account.hard_limit_amount AS CHAR)
                 AS hardLimitAmount,
               CAST(account.consumed_amount AS CHAR)
                 AS consumedAmount,
               CAST(account.reserved_amount AS CHAR)
                 AS reservedAmount,
               CAST(account.unknown_held_amount AS CHAR)
                 AS unknownHeldAmount,
               CAST(
                 GREATEST(
                   account.hard_limit_amount
                     - account.consumed_amount
                     - account.reserved_amount
                     - account.unknown_held_amount,
                   0
                 )
                 AS CHAR
               ) AS remainingAmount,
               account.version
             FROM budget_account AS account
             INNER JOIN provider_setting AS setting
               ON setting.workspace_id = account.workspace_id
              AND setting.budget_account_id = account.id
             WHERE account.workspace_id = ?
               AND setting.deleted_at IS NULL
               AND account.period_start_at <= ?
               AND account.period_end_at > ?
             ORDER BY
               account.lifecycle_status = 'active' DESC,
               account.period_end_at ASC,
               account.id ASC
             LIMIT 128`,
          [scope.workspaceId, now, now],
        );
        const [overviewRows] = await connection.execute<UsageOverviewRow[]>(
          `SELECT
               COUNT(DISTINCT capability_attempt_id)
                 AS trackedAttemptCount,
               COALESCE(
                 SUM(entry_kind = 'unknown'),
                 0
               ) AS unknownUsageCount
             FROM usage_ledger_entry
             WHERE workspace_id = ?
               AND recorded_at >= ?
               AND recorded_at <= ?`,
          [scope.workspaceId, windowStartAt, now],
        );
        const [unknownHoldRows] = await connection.execute<
          UnknownBudgetHoldRow[]
        >(
          `SELECT
               reservation.id,
               COALESCE(
                 setting.display_name,
                 '团队模型服务'
               ) AS providerName,
               reservation.workflow_run_id AS workflowRunId,
               reservation.capability_run_id AS capabilityRunId,
               invocation.provider_request_id AS providerRequestId,
               reservation.currency_code AS currencyCode,
               CAST(reservation.unknown_hold_amount AS CHAR)
                 AS heldAmount,
               reservation.version,
               invocation.submission_started_at AS submittedAt,
               reservation.settled_at AS heldAt
             FROM budget_reservation AS reservation
             INNER JOIN budget_account AS account
               ON account.workspace_id = reservation.workspace_id
              AND account.id = reservation.budget_account_id
             INNER JOIN provider_setting AS setting
               ON setting.workspace_id = account.workspace_id
              AND setting.budget_account_id = account.id
             LEFT JOIN provider_invocation AS invocation
               ON invocation.workspace_id = reservation.workspace_id
              AND invocation.budget_reservation_id = reservation.id
             WHERE reservation.workspace_id = ?
               AND setting.deleted_at IS NULL
               AND reservation.lifecycle_status = 'unknown'
               AND reservation.unknown_hold_amount IS NOT NULL
             ORDER BY
               reservation.settled_at DESC,
               reservation.id DESC
             LIMIT 128`,
          [scope.workspaceId],
        );
        const [metricRows] = await connection.execute<UsageMetricRow[]>(
          `SELECT
               metric_key AS metricKey,
               value_dimension AS dimension,
               unit_code AS unitCode,
               currency_code AS currencyCode,
               CAST(
                 COALESCE(SUM(COALESCE(numeric_value, 0)), 0)
                 AS CHAR
               ) AS value,
               COALESCE(
                 SUM(entry_kind = 'unknown'),
                 0
               ) AS unknownCount,
               MAX(recorded_at) AS lastRecordedAt
             FROM usage_ledger_entry
             WHERE workspace_id = ?
               AND recorded_at >= ?
               AND recorded_at <= ?
             GROUP BY
               metric_key,
               value_dimension,
               unit_code,
               currency_code
             ORDER BY lastRecordedAt DESC, metricKey ASC
             LIMIT 256`,
          [scope.workspaceId, windowStartAt, now],
        );
        const overview = overviewRows[0];
        return Object.freeze({
          trackedAttemptCount: Number(overview?.trackedAttemptCount ?? 0),
          unknownUsageCount: Number(overview?.unknownUsageCount ?? 0),
          budgets: Object.freeze(
            budgetRows.map((row) =>
              Object.freeze({
                name: row.name,
                ...(row.providerSettingId
                  ? {
                      providerSettingId: row.providerSettingId,
                    }
                  : {}),
                status: row.status,
                currencyCode: row.currencyCode,
                periodStartAt: new Date(row.periodStartAt),
                periodEndAt: new Date(row.periodEndAt),
                hardLimitAmount: row.hardLimitAmount,
                consumedAmount: row.consumedAmount,
                reservedAmount: row.reservedAmount,
                unknownHeldAmount: row.unknownHeldAmount,
                remainingAmount: row.remainingAmount,
                version: row.version,
              }),
            ),
          ),
          unknownHolds: Object.freeze(
            unknownHoldRows.map((row) =>
              Object.freeze({
                id: row.id,
                providerName: row.providerName,
                ...(row.capabilityRunId
                  ? { capabilityRunId: row.capabilityRunId }
                  : {}),
                ...(row.workflowRunId
                  ? { workflowRunId: row.workflowRunId }
                  : {}),
                ...(row.providerRequestId
                  ? {
                      providerRequestId: row.providerRequestId,
                    }
                  : {}),
                currencyCode: row.currencyCode,
                heldAmount: row.heldAmount,
                version: row.version,
                ...(row.submittedAt
                  ? {
                      submittedAt: new Date(row.submittedAt),
                    }
                  : {}),
                heldAt: new Date(row.heldAt),
              }),
            ),
          ),
          metrics: Object.freeze(metricRows.map(metricFrom)),
        });
      });
    },
    async updateBudgetLimit(
      options: UpdateWorkspaceBudgetLimitOptions,
    ): Promise<WorkspaceBudgetMutationRecord> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const [rows] = await connection.execute<BudgetLimitRow[]>(
          `SELECT
             account.id,
             CAST(account.hard_limit_amount AS CHAR)
               AS hardLimitAmount,
             CAST(account.consumed_amount AS CHAR)
               AS consumedAmount,
             CAST(account.reserved_amount AS CHAR)
               AS reservedAmount,
             CAST(account.unknown_held_amount AS CHAR)
               AS unknownHeldAmount,
             account.lifecycle_status AS lifecycleStatus,
             account.version
           FROM provider_setting AS setting
           INNER JOIN budget_account AS account
             ON account.workspace_id = setting.workspace_id
            AND account.id = setting.budget_account_id
           WHERE setting.workspace_id = ?
             AND setting.id = ?
             AND setting.deleted_at IS NULL
           LIMIT 1
           FOR UPDATE`,
          [options.scope.workspaceId, options.providerSettingId],
        );
        const current = rows[0];
        if (!current) {
          throw new WorkspaceUsageSummaryStoreError(
            "budget.not_found",
            "The Provider budget does not exist.",
          );
        }
        if (current.version !== options.expectedVersion) {
          throw new WorkspaceUsageSummaryStoreError(
            "budget.version_conflict",
            "The Provider budget changed before this update.",
          );
        }
        const nextLimit = decimalToUnits(
          options.hardLimitAmount,
          "hardLimitAmount",
        );
        const committed =
          decimalToUnits(current.consumedAmount, "consumedAmount") +
          decimalToUnits(current.reservedAmount, "reservedAmount") +
          decimalToUnits(current.unknownHeldAmount, "unknownHeldAmount");
        if (nextLimit < committed) {
          throw new WorkspaceUsageSummaryStoreError(
            "budget.limit_below_committed",
            "The spending limit cannot be lower than the amount already used or held.",
          );
        }
        const nextVersion = current.version + 1;
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE budget_account
             SET hard_limit_amount = ?,
                 lifecycle_status = CASE
                   WHEN lifecycle_status = 'exhausted'
                     AND ? > (
                       consumed_amount
                       + reserved_amount
                       + unknown_held_amount
                     )
                   THEN 'active'
                   ELSE lifecycle_status
                 END,
                 version = ?,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?`,
          [
            options.hardLimitAmount,
            options.hardLimitAmount,
            nextVersion,
            options.now,
            options.scope.workspaceId,
            current.id,
            current.version,
          ],
        );
        if (result.affectedRows !== 1) {
          throw new WorkspaceUsageSummaryStoreError(
            "budget.version_conflict",
            "The Provider budget changed before this update.",
          );
        }
        return Object.freeze({
          providerSettingId: options.providerSettingId,
          hardLimitAmount: options.hardLimitAmount,
          version: nextVersion,
          updatedAt: options.now,
        });
      });
    },
  });
}
