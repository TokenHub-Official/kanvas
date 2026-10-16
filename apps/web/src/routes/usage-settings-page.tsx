import {
  ArrowRightOutlined,
  CopyOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useReducer, useState, type ChangeEvent } from "react";
import { AgentRunDiagnostics } from "../features/agent/agent-run-diagnostics.js";
import type {
  WorkspaceBudgetSummary,
  WorkspaceUnknownBudgetHold,
  WorkspaceUsageSummary,
} from "@kanvas/contracts/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Collapse,
  Form,
  Progress,
  Radio,
  Spin,
  Statistic,
  Table,
  type RadioChangeEvent,
  type TableColumnsType,
} from "antd";
import { useTranslation } from "react-i18next";

import {
  ApiProblem,
  fetchWorkspaceUsageSummary,
  resolveUnknownBudgetHold,
} from "../api/transport.js";
import { httpStatus } from "../api/http-status.js";
import { workspaceQueryKeys } from "../api/query-keys.js";
import {
  SettingsAlertDialog as AlertDialog,
  SettingsAlertDialogContent as AlertDialogContent,
  SettingsDialog as Dialog,
  SettingsDialogContent as DialogContent,
} from "../components/settings-overlay.js";
import { EmptyState, InlineNotice } from "../components/feedback.js";
import { KanvasInput } from "../components/kanvas-input.js";
import { usePageQueryRecovery } from "../components/page-query-recovery.js";
import {
  SettingsPageHeader,
  SettingsShell,
} from "../components/settings-shell.js";
import { StatusBadge } from "../components/status-badge.js";
import { StatusTag } from "../components/status-tag.js";
import { UnsavedChangesGuard } from "../components/unsaved-changes-guard.js";
import { WorkspacePage } from "../components/workspace-page.js";
import {
  budgetConsumptionPercent,
  budgetUnavailableAmount,
  formatBudgetAmount,
  formatUsageMetric,
  reconciliationEvidenceSummary,
  reconciliationTimestamp,
  usageMetricLabel,
} from "../features/usage/usage-summary-model.js";
import { BudgetLimitDialog } from "../features/usage/budget-limit-dialog.js";
import {
  initialUnknownHoldResolutionState,
  reduceUnknownHoldResolution,
  unknownHoldResolutionDirty,
  type UnknownHoldResolutionFieldErrors,
} from "../features/usage/unknown-hold-resolution-state.js";
import { i18n } from "../i18n/i18n.js";

const usageSettingsRouteApi = getRouteApi("/w/$workspaceId/settings/usage");

const USAGE_TABLE_PAGE_SIZE = 5;
const UNKNOWN_HOLDS_SCROLL_WIDTH = 890;
const UNKNOWN_HOLDS_ACTION_SCROLL_WIDTH = 1_020;
const budgetStatus: Readonly<
  Record<
    WorkspaceBudgetSummary["status"],
    {
      readonly labelKey: string;
      readonly tone: "neutral" | "positive" | "warning" | "danger";
    }
  >
> = {
  active: { labelKey: "active", tone: "positive" },
  frozen: { labelKey: "frozen", tone: "warning" },
  exhausted: { labelKey: "exhausted", tone: "danger" },
  closed: { labelKey: "closed", tone: "neutral" },
};

interface ResolutionNotice {
  readonly message: string;
  readonly title: string;
  readonly tone: "info" | "positive";
}

type ResolutionFocus = "budget" | "next-hold" | "none" | "refresh";
const MIN_EVIDENCE_REFERENCE_LENGTH = 3;

function fullDate(value: string): string {
  return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? "zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function budgetTotals(budgets: readonly WorkspaceBudgetSummary[]): {
  readonly currencyCode: string | undefined;
  readonly consumed: number;
  readonly hardLimit: number;
  readonly remaining: number;
  readonly reserved: number;
  readonly unknownHeld: number;
} {
  const currencyCodes = new Set(budgets.map((budget) => budget.currencyCode));
  return {
    currencyCode:
      currencyCodes.size === 1 ? budgets[0]?.currencyCode : undefined,
    consumed: budgets.reduce(
      (total, budget) => total + Number(budget.consumedAmount),
      0,
    ),
    hardLimit: budgets.reduce(
      (total, budget) => total + Number(budget.hardLimitAmount),
      0,
    ),
    remaining: budgets.reduce(
      (total, budget) => total + Number(budget.remainingAmount),
      0,
    ),
    reserved: budgets.reduce(
      (total, budget) => total + Number(budget.reservedAmount),
      0,
    ),
    unknownHeld: budgets.reduce(
      (total, budget) => total + Number(budget.unknownHeldAmount),
      0,
    ),
  };
}

function formatTotal(amount: number, currencyCode: string | undefined): string {
  return currencyCode
    ? formatBudgetAmount(String(amount), currencyCode)
    : i18n.t("settings.usage.multipleCurrencies");
}

function budgetAvailableForNewTasks(budget: WorkspaceBudgetSummary): boolean {
  return budget.status === "active" && Number(budget.remainingAmount) > 0;
}

function RunDiagnosticLink({
  capabilityRunId,
  workflowRunId,
  workspaceId,
}: {
  readonly workflowRunId: string | undefined;
  readonly capabilityRunId?: string | undefined;
  readonly workspaceId: string;
}): React.JSX.Element | string {
  const { t } = useTranslation();
  const taskId = capabilityRunId ?? workflowRunId;
  if (!taskId) {
    return t("settings.usage.notLinked");
  }
  return (
    <Link
      className="font-bold text-primary no-underline hover:underline focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
      params={{ workflowRunId: taskId, workspaceId }}
      search={{
        returnTo: `/w/${workspaceId}/settings/usage`,
        ...(capabilityRunId ? { kind: "capability" as const } : {}),
      }}
      to="/w/$workspaceId/settings/runs/$workflowRunId"
    >
      {t("settings.usage.viewRun")}
    </Link>
  );
}

export function UsageSettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = usageSettingsRouteApi.useParams();
  return (
    <WorkspacePage
      pageTitle={t("settings.usage.title")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <SettingsShell active="usage" workspace={workspace}>
          {workspace.permissions.includes("usage.read") ? (
            <UsageSettingsContent
              canReadAudit={workspace.permissions.includes("audit.read")}
              canManageProviders={workspace.permissions.includes(
                "credential.manage",
              )}
              csrfToken={context.csrfToken}
              workspaceId={workspace.id}
            />
          ) : (
            <EmptyState title={t("settings.usage.forbiddenTitle")}>
              {t("settings.usage.forbiddenDescription")}
            </EmptyState>
          )}
        </SettingsShell>
      )}
    </WorkspacePage>
  );
}

function UsageSettingsContent({
  canReadAudit,
  canManageProviders,
  csrfToken,
  workspaceId,
}: {
  readonly canReadAudit: boolean;
  readonly canManageProviders: boolean;
  readonly csrfToken: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const { notification } = AntApp.useApp();
  const summary = useQuery({
    queryKey: workspaceQueryKeys.usageSummary(workspaceId),
    queryFn: () => fetchWorkspaceUsageSummary(workspaceId),
    retry: false,
  });
  const recovery = usePageQueryRecovery(summary.refetch);

  if (summary.isPending) {
    return (
      <div
        aria-live="polite"
        className="flex min-h-90 items-center justify-center gap-2.5 text-xs text-muted"
        role="status"
      >
        <Spin aria-hidden="true" size="small" />
        {t("settings.usage.loading")}
      </div>
    );
  }
  if (summary.isError && !summary.data) {
    const forbidden =
      summary.error instanceof ApiProblem &&
      summary.error.status === httpStatus.forbidden;
    return (
      <EmptyState
        action={() => {
          if (forbidden) {
            window.location.reload();
            return;
          }
          recovery.retry();
        }}
        actionLabel={
          forbidden
            ? t("settings.usage.recheckPermission")
            : t("settings.usage.reload")
        }
        actionPending={!forbidden && recovery.pending}
        title={
          forbidden
            ? t("settings.usage.forbiddenTitle")
            : t("settings.usage.loadErrorTitle")
        }
      >
        {forbidden
          ? t("settings.usage.forbiddenLoadDescription")
          : t("common.checkConnection")}
      </EmptyState>
    );
  }

  const data = summary.data;
  const availableBudgets = data.budgets.filter(budgetAvailableForNewTasks);
  const pausedBudgets = data.budgets.filter(
    (budget) => !budgetAvailableForNewTasks(budget),
  );
  const availableTotals = budgetTotals(availableBudgets);
  const allTotals = budgetTotals(data.budgets);
  const handleResolution = (
    notice: ResolutionNotice,
    focus: ResolutionFocus,
  ): void => {
    notification[notice.tone === "positive" ? "success" : "info"]({
      title: notice.title,
      description: notice.message,
    });
    let targetId: string | undefined;
    if (focus === "budget") targetId = "usage-budget-title";
    else if (focus === "refresh") targetId = "usage-refresh-button";
    else if (focus === "next-hold") targetId = "usage-unknown-holds-title";
    if (targetId) {
      window.requestAnimationFrame(() => {
        document.getElementById(targetId)?.focus();
      });
    }
  };
  return (
    <div className="w-full">
      <SettingsPageHeader
        action={
          <div className="flex flex-wrap gap-2">
            {canReadAudit ? (
              <Button onClick={() => setDiagnosticsOpen(true)}>
                {t("agent.diagnostics.lookup")}
              </Button>
            ) : null}
            <Button
              aria-busy={summary.isFetching}
              disabled={summary.isFetching}
              icon={<ReloadOutlined aria-hidden="true" />}
              id="usage-refresh-button"
              loading={summary.isFetching}
              onClick={() => {
                void summary.refetch();
              }}
            >
              {t("settings.usage.refresh")}
            </Button>
          </div>
        }
        title={t("settings.usage.title")}
      />
      {diagnosticsOpen && canReadAudit ? (
        <AgentRunDiagnostics
          workspaceId={workspaceId}
          onClose={() => setDiagnosticsOpen(false)}
        />
      ) : null}

      {summary.isError ? (
        <InlineNotice title={t("settings.usage.staleTitle")} tone="info">
          {t("settings.usage.staleDescription")}
        </InlineNotice>
      ) : null}

      {data.unknownHolds.length > 0 ? (
        <Alert
          action={
            <Button href="#usage-unknown-holds-title" size="small" type="link">
              {t("settings.usage.holdsAction")}
            </Button>
          }
          className="mt-6"
          description={t("settings.usage.holdsDescription")}
          title={t("settings.usage.holdsTitle", {
            count: data.unknownHolds.length,
          })}
          showIcon
          type="warning"
        />
      ) : null}

      {data.budgets.length > 0 ? (
        <section
          aria-label={t("settings.usage.overviewLabel")}
          className="mt-6"
        >
          <Card
            className="overflow-hidden shadow-[0_12px_32px_rgb(35_32_68_/_6%)]"
            styles={{ body: { padding: 0 } }}
            variant="borderless"
          >
            <div className="grid lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.45fr)]">
              <div className="border-b border-line bg-primary-soft/55 p-6 lg:border-r lg:border-b-0">
                <Statistic
                  title={
                    <span className="text-sm font-semibold text-muted">
                      {t("settings.usage.availableBalance")}
                    </span>
                  }
                  value={formatTotal(
                    availableTotals.remaining,
                    availableTotals.currencyCode ?? allTotals.currencyCode,
                  )}
                  styles={{
                    content: {
                      color: "var(--ink)",
                      fontSize: 36,
                      fontWeight: 750,
                      lineHeight: 1.1,
                    },
                  }}
                />
                <div className="mt-5 flex flex-wrap items-center gap-3 text-xs">
                  <StatusBadge
                    tone={availableBudgets.length > 0 ? "positive" : "warning"}
                  >
                    {t("settings.usage.availableSummary", {
                      count: availableBudgets.length,
                    })}
                  </StatusBadge>
                  <span className="text-muted">
                    {t("settings.usage.onlyAvailableServices")}
                  </span>
                </div>
              </div>
              <div className="grid sm:grid-cols-3">
                {(
                  [
                    [
                      t("settings.usage.totals.used"),
                      formatTotal(allTotals.consumed, allTotals.currencyCode),
                    ],
                    [
                      t("settings.usage.totals.processing"),
                      formatTotal(allTotals.reserved, allTotals.currencyCode),
                    ],
                    [
                      t("settings.usage.totals.held"),
                      formatTotal(
                        allTotals.unknownHeld,
                        allTotals.currencyCode,
                      ),
                    ],
                  ] as const
                ).map(([label, value]) => (
                  <div
                    className="border-b border-line p-5 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
                    key={label}
                  >
                    <Statistic
                      title={
                        <span className="text-xs text-muted">{label}</span>
                      }
                      value={value}
                      styles={{
                        content: {
                          color: "var(--ink)",
                          fontSize: 20,
                          fontWeight: 700,
                          lineHeight: 1.25,
                        },
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="usage-budget-title" className="mt-8">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2
            className="text-[20px] font-bold tracking-[-0.015em]"
            id="usage-budget-title"
            tabIndex={-1}
          >
            {t("settings.usage.budgetsTitle")}
          </h2>
          <span className="text-xs text-muted">
            {t("settings.usage.updatedAt", {
              date: fullDate(data.generatedAt),
            })}
          </span>
        </div>
        {data.budgets.length === 0 ? (
          <div className="rounded-card bg-paper px-5 py-6 shadow-[0_8px_24px_rgb(35_32_68_/_5%)]">
            <strong className="block text-sm">
              {t("settings.usage.emptyBudgetsTitle")}
            </strong>
            <p className="mt-1 max-w-170 text-sm leading-6 text-muted">
              {t("settings.usage.emptyBudgetsDescription")}
            </p>
            {canManageProviders ? (
              <Link
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-primary no-underline hover:underline focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-primary"
                params={{ workspaceId }}
                to="/w/$workspaceId/settings/providers"
              >
                {t("settings.usage.manageProviders")}
                <ArrowRightOutlined aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4">
            {availableBudgets.length > 0 ? (
              <BudgetTable
                budgets={availableBudgets}
                canConfigure={canManageProviders}
                csrfToken={csrfToken}
                workspaceId={workspaceId}
              />
            ) : (
              <Alert
                action={
                  canManageProviders ? (
                    <Link
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-bold text-primary no-underline hover:underline focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-primary"
                      params={{ workspaceId }}
                      to="/w/$workspaceId/settings/models"
                    >
                      {t("settings.usage.manageProviders")}
                      <ArrowRightOutlined aria-hidden="true" />
                    </Link>
                  ) : undefined
                }
                description={t("settings.usage.noAvailableBudgetsDescription")}
                title={t("settings.usage.noAvailableBudgetsTitle")}
                showIcon
                type="info"
              />
            )}
            {pausedBudgets.length > 0 ? (
              <Collapse
                className="rounded-[20px] bg-paper shadow-[var(--shadow-section)]"
                ghost
                items={[
                  {
                    key: "paused",
                    label: t("settings.usage.pausedBudgetsTitle", {
                      count: pausedBudgets.length,
                    }),
                    children: (
                      <BudgetTable
                        budgets={pausedBudgets}
                        canConfigure={canManageProviders}
                        csrfToken={csrfToken}
                        muted
                        workspaceId={workspaceId}
                      />
                    ),
                  },
                ]}
              />
            ) : null}
          </div>
        )}
      </section>

      <UsageMetrics data={data} />

      <UnknownHoldsSection
        canResolve={canManageProviders}
        csrfToken={csrfToken}
        holds={data.unknownHolds}
        onResolved={handleResolution}
        workspaceId={workspaceId}
      />
    </div>
  );
}

function BudgetTable({
  budgets,
  canConfigure,
  csrfToken,
  muted = false,
  workspaceId,
}: {
  readonly budgets: readonly WorkspaceBudgetSummary[];
  readonly canConfigure: boolean;
  readonly csrfToken: string;
  readonly muted?: boolean;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const columns: TableColumnsType<WorkspaceBudgetSummary> = [
    {
      key: "provider",
      title: t("settings.usage.columns.provider"),
      width: 280,
      render: (_, budget) => {
        const hasUnknownHold = Number(budget.unknownHeldAmount) > 0;
        const visibleStatus = budgetStatus[budget.status];
        return (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="min-w-0 text-sm">{budget.name}</strong>
              <StatusTag tone={visibleStatus.tone}>
                {t(`settings.usage.budgetStatus.${visibleStatus.labelKey}`)}
              </StatusTag>
            </div>
            {hasUnknownHold ? (
              <span className="mt-1 block text-xs text-muted">
                {t("settings.usage.unknownCharge")}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "consumed",
      title: t("settings.usage.columns.consumed"),
      width: 320,
      render: (_, budget) => {
        const unavailableAmount = budgetUnavailableAmount(budget);
        const consumption = Math.round(budgetConsumptionPercent(budget));
        return (
          <div className="min-w-55">
            <strong className="text-sm tabular-nums">
              {formatBudgetAmount(
                String(unavailableAmount),
                budget.currencyCode,
              )}{" "}
              <span className="font-normal text-muted">
                /{" "}
                {formatBudgetAmount(
                  budget.hardLimitAmount,
                  budget.currencyCode,
                )}
              </span>
            </strong>
            <Progress
              aria-label={t("settings.usage.progressLabel", {
                name: budget.name,
                amount: formatBudgetAmount(
                  String(unavailableAmount),
                  budget.currencyCode,
                ),
                percent: consumption,
              })}
              className="mt-1.5"
              percent={consumption}
              railColor="var(--mist-deep)"
              showInfo={false}
              size="small"
              strokeColor="var(--primary)"
            />
          </div>
        );
      },
    },
    {
      align: "right",
      key: "remaining",
      title: t("settings.usage.columns.remaining"),
      width: 150,
      render: (_, budget) => (
        <strong className="text-sm tabular-nums">
          {formatBudgetAmount(budget.remainingAmount, budget.currencyCode)}
        </strong>
      ),
    },
    {
      align: "right",
      key: "actions",
      title: t("settings.usage.columns.actions"),
      width: 120,
      render: (_, budget) =>
        canConfigure && budget.providerSettingId ? (
          <BudgetLimitDialog
            budget={budget}
            csrfToken={csrfToken}
            workspaceId={workspaceId}
          />
        ) : (
          <span className="text-xs text-muted">
            {t("settings.usage.readOnly")}
          </span>
        ),
    },
  ];
  return (
    <Table<WorkspaceBudgetSummary>
      className={
        muted
          ? "overflow-hidden rounded-[16px] border border-line"
          : "overflow-hidden rounded-[20px] shadow-[0_12px_32px_rgb(35_32_68_/_6%)]"
      }
      columns={columns}
      dataSource={[...budgets]}
      pagination={
        budgets.length > USAGE_TABLE_PAGE_SIZE
          ? { pageSize: USAGE_TABLE_PAGE_SIZE, showSizeChanger: false }
          : false
      }
      rowKey={(budget) =>
        `${budget.providerSettingId ?? budget.name}:${budget.periodStartAt}:${budget.periodEndAt}:${budget.currencyCode}`
      }
      scroll={{ x: 870 }}
      size="middle"
    />
  );
}

function UnknownHoldsSection({
  canResolve,
  csrfToken,
  holds,
  onResolved,
  workspaceId,
}: {
  readonly canResolve: boolean;
  readonly csrfToken: string;
  readonly holds: readonly WorkspaceUnknownBudgetHold[];
  readonly onResolved: (
    notice: ResolutionNotice,
    focus: ResolutionFocus,
  ) => void;
  readonly workspaceId: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (holds.length === 0) {
    return null;
  }
  const columns: TableColumnsType<WorkspaceUnknownBudgetHold> = [
    {
      dataIndex: "providerName",
      key: "provider",
      title: t("settings.usage.holds.provider"),
      width: 220,
    },
    {
      align: "right",
      key: "amount",
      title: t("settings.usage.holds.heldAmount"),
      width: 140,
      render: (_, hold) => (
        <strong className="tabular-nums">
          {formatBudgetAmount(hold.heldAmount, hold.currencyCode)}
        </strong>
      ),
    },
    {
      key: "started",
      title: t("settings.usage.resolve.reconciliationTime"),
      width: 220,
      render: (_, hold) => fullDate(hold.heldAt),
    },
    {
      key: "run",
      title: t("settings.usage.holds.run"),
      width: 160,
      render: (_, hold) => (
        <RunDiagnosticLink
          workflowRunId={hold.workflowRunId}
          capabilityRunId={hold.capabilityRunId}
          workspaceId={workspaceId}
        />
      ),
    },
    {
      key: "status",
      title: t("settings.usage.holds.status"),
      width: 150,
      render: () => (
        <StatusTag tone="warning">
          {t("settings.usage.holds.reconciling")}
        </StatusTag>
      ),
    },
    ...(canResolve
      ? [
          {
            align: "right" as const,
            fixed: "right" as const,
            key: "action",
            title: t("settings.usage.columns.actions"),
            width: 130,
            render: (_: unknown, hold: WorkspaceUnknownBudgetHold) => (
              <UnknownHoldResolutionDialog
                csrfToken={csrfToken}
                hold={hold}
                onResolved={onResolved}
                workspaceId={workspaceId}
              />
            ),
          },
        ]
      : []),
  ];
  return (
    <section aria-labelledby="usage-unknown-holds-title" className="mt-8">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            className="text-base font-bold"
            id="usage-unknown-holds-title"
            tabIndex={-1}
          >
            {t("settings.usage.holds.title")}
          </h2>
          <p className="mt-1 max-w-190 text-xs leading-5 text-muted">
            {t("settings.usage.holds.description")}
          </p>
        </div>
        <StatusBadge tone="warning">
          {t("settings.usage.holdsSummary", { count: holds.length })}
        </StatusBadge>
      </div>
      <Collapse
        className="overflow-hidden rounded-[20px] bg-paper shadow-[var(--shadow-section)]"
        items={[
          {
            key: "holds",
            label: t("settings.usage.holdsAction"),
            children: (
              <Table<WorkspaceUnknownBudgetHold>
                className="overflow-hidden rounded-[16px] border border-line"
                columns={columns}
                dataSource={[...holds]}
                pagination={{
                  pageSize: USAGE_TABLE_PAGE_SIZE,
                  showSizeChanger: false,
                }}
                rowKey="id"
                scroll={{
                  x: canResolve
                    ? UNKNOWN_HOLDS_ACTION_SCROLL_WIDTH
                    : UNKNOWN_HOLDS_SCROLL_WIDTH,
                }}
                size="middle"
              />
            ),
          },
        ]}
      />
    </section>
  );
}

export function UnknownHoldResolutionDialog({
  csrfToken,
  hold,
  onResolved,
  workspaceId,
}: {
  readonly csrfToken: string;
  readonly hold: WorkspaceUnknownBudgetHold;
  readonly onResolved: (
    notice: ResolutionNotice,
    focus: ResolutionFocus,
  ) => void;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const resolutionErrorId = `unknown-hold-${hold.id}-resolution-error`;
  const chargedAmountId = `unknown-hold-${hold.id}-charged-amount`;
  const evidenceReferenceId = `unknown-hold-${hold.id}-evidence-reference`;
  const submittedAt = hold.submittedAt
    ? reconciliationTimestamp(hold.submittedAt)
    : undefined;
  const evidenceSummary = reconciliationEvidenceSummary(hold);
  const [resolutionState, updateResolutionState] = useReducer(
    reduceUnknownHoldResolution,
    initialUnknownHoldResolutionState,
  );
  const {
    chargedAmount,
    copyStatus,
    discardRequested,
    evidenceReference,
    fieldErrors,
    formError,
    locallyResolved,
    open,
    resolution,
  } = resolutionState;
  const dirty = unknownHoldResolutionDirty(resolutionState);

  const copyEvidenceSummary = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(evidenceSummary);
      updateResolutionState({
        type: "copy_status_changed",
        status: "copied",
      });
    } catch {
      updateResolutionState({
        type: "copy_status_changed",
        status: "failed",
      });
    }
  };
  const mutation = useMutation({
    mutationFn: () =>
      resolveUnknownBudgetHold(
        {
          csrfToken,
          workspaceId,
        },
        hold.id,
        {
          expectedVersion: hold.version,
          resolution: resolution ?? "not_charged",
          ...(resolution === "charged"
            ? { chargedAmount: chargedAmount.trim() }
            : {}),
          evidenceReference: evidenceReference.trim(),
        },
      ),
    onSuccess: async (result) => {
      updateResolutionState({ type: "resolved" });
      onResolved(
        {
          title: t("settings.usage.resolve.refreshingTitle"),
          message: t("settings.usage.resolve.refreshingDescription"),
          tone: "info",
        },
        "none",
      );
      try {
        await queryClient.invalidateQueries(
          {
            queryKey: workspaceQueryKeys.usageSummary(workspaceId),
          },
          { throwOnError: true },
        );
        const refreshed = queryClient.getQueryData<WorkspaceUsageSummary>(
          workspaceQueryKeys.usageSummary(workspaceId),
        );
        const remainingHoldCount =
          refreshed?.unknownHolds.filter((item) => item.id !== hold.id)
            .length ?? 0;
        onResolved(
          {
            title: t("settings.usage.resolve.successTitle"),
            message:
              result.lifecycleStatus === "released"
                ? t("settings.usage.resolve.released", {
                    count: remainingHoldCount,
                  })
                : t("settings.usage.resolve.charged", {
                    amount: formatBudgetAmount(
                      result.chargedAmount,
                      hold.currencyCode,
                    ),
                    count: remainingHoldCount,
                  }),
            tone: "positive",
          },
          remainingHoldCount > 0 ? "next-hold" : "budget",
        );
      } catch {
        onResolved(
          {
            title: t("settings.usage.resolve.refreshErrorTitle"),
            message: t("settings.usage.resolve.refreshErrorDescription"),
            tone: "info",
          },
          "refresh",
        );
      }
    },
    onError: (error) => {
      if (error instanceof ApiProblem && error.status === httpStatus.conflict) {
        updateResolutionState({
          type: "request_failed",
          error: t("settings.usage.resolve.conflict"),
        });
        void queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.usageSummary(workspaceId),
        });
        return;
      }
      updateResolutionState({
        type: "request_failed",
        error: t("settings.usage.resolve.genericError"),
      });
    },
  });

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    updateResolutionState({ type: "request_started" });
    const nextErrors: UnknownHoldResolutionFieldErrors = {
      resolution: undefined,
      chargedAmount: undefined,
      evidenceReference: undefined,
    };
    if (!resolution) {
      nextErrors.resolution = t("settings.usage.resolve.resolutionRequired");
    }
    if (resolution === "charged") {
      const amount = Number(chargedAmount);
      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > Number(hold.heldAmount)
      ) {
        nextErrors.chargedAmount = t("settings.usage.resolve.amountInvalid", {
          amount: formatBudgetAmount(hold.heldAmount, hold.currencyCode),
        });
      }
    }
    if (evidenceReference.trim().length < MIN_EVIDENCE_REFERENCE_LENGTH) {
      nextErrors.evidenceReference = t(
        "settings.usage.resolve.evidenceRequired",
      );
    }
    updateResolutionState({
      type: "validation_failed",
      fieldErrors: nextErrors,
    });
    if (Object.values(nextErrors).some((error) => error !== undefined)) {
      window.requestAnimationFrame(() => {
        if (nextErrors.resolution) {
          document.getElementById(`unknown-hold-${hold.id}-charged`)?.focus();
        } else if (nextErrors.chargedAmount) {
          document.getElementById(chargedAmountId)?.focus();
        } else {
          document.getElementById(evidenceReferenceId)?.focus();
        }
      });
      return;
    }
    mutation.mutate();
  };
  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && mutation.isPending) {
      return;
    }
    if (!nextOpen) {
      updateResolutionState({ type: "request_close" });
      return;
    }
    updateResolutionState({ type: "open" });
  };
  const handleResolutionChange = (event: RadioChangeEvent) => {
    const value = event.target.value as "charged" | "not_charged";
    updateResolutionState({ type: "resolution_changed", resolution: value });
  };
  const handleChargedAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateResolutionState({
      type: "charged_amount_changed",
      value: event.target.value,
    });
  };
  const handleEvidenceReferenceChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    updateResolutionState({
      type: "evidence_reference_changed",
      value: event.target.value,
    });
  };
  const discardResolutionDraft = () => {
    updateResolutionState({ type: "discard" });
  };
  const openResolutionDialog = () => {
    updateResolutionState({ type: "open" });
  };
  const requestResolutionClose = () => {
    updateResolutionState({ type: "request_close" });
  };

  let copyStatusLabel = t("settings.usage.resolve.copyDescription");
  if (copyStatus === "copied") {
    copyStatusLabel = t("settings.usage.resolve.copied");
  } else if (copyStatus === "failed") {
    copyStatusLabel = t("settings.usage.resolve.copyFailed");
  }
  let submitLabel = t("settings.usage.resolve.submit");
  if (resolution === "charged") {
    submitLabel = t("settings.usage.resolve.submitCharged");
  } else if (resolution === "not_charged") {
    submitLabel = t("settings.usage.resolve.submitReleased");
  }

  return (
    <>
      <UnsavedChangesGuard
        active={open && dirty}
        title={t("settings.usage.resolve.leaveTitle")}
      >
        {t("settings.usage.resolve.leaveDescription")}
      </UnsavedChangesGuard>
      <Dialog onOpenChange={handleDialogOpenChange} open={open}>
        <Button
          disabled={locallyResolved}
          onClick={openResolutionDialog}
          size="small"
        >
          {locallyResolved
            ? t("settings.usage.resolve.waitingRefresh")
            : t("settings.usage.resolve.action")}
        </Button>
        <DialogContent
          closeLabel={t("common.dialog.close")}
          dismissible={!mutation.isPending}
          title={t("settings.usage.resolve.title")}
          width={640}
        >
          <form noValidate onSubmit={submit}>
            <InlineNotice
              title={t("settings.usage.resolve.warningTitle")}
              tone="info"
            >
              {t("settings.usage.resolve.warningDescription")}
            </InlineNotice>
            <div className="mt-5 rounded-control bg-mist p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <strong className="text-sm">
                    {t("settings.usage.resolve.evidenceTitle")}
                  </strong>
                  <p className="mt-1 max-w-150 text-xs leading-5 text-muted">
                    {t("settings.usage.resolve.evidenceDescription")}
                  </p>
                </div>
                <Button
                  icon={<CopyOutlined aria-hidden="true" />}
                  onClick={() => {
                    void copyEvidenceSummary();
                  }}
                  size="small"
                  htmlType="button"
                >
                  {t("settings.usage.resolve.copyEvidence")}
                </Button>
              </div>
              <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">
                    {t("settings.usage.holds.provider")}
                  </dt>
                  <dd className="mt-1 break-words font-bold">
                    {hold.providerName}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">
                    {t("settings.usage.holds.heldAmount")}
                  </dt>
                  <dd className="mt-1 font-bold">
                    {formatBudgetAmount(hold.heldAmount, hold.currencyCode)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">
                    {t("settings.usage.holds.externalTask")}
                  </dt>
                  <dd className="mt-1 break-all font-medium">
                    {hold.providerRequestId ??
                      t("settings.usage.holds.noExternalTask")}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted">
                    {t("settings.usage.resolve.reconciliationTime")}
                  </dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {submittedAt ? (
                      <>
                        <time dateTime={hold.submittedAt}>
                          {submittedAt.localDateTime} {submittedAt.localZone}
                        </time>
                        <span className="block text-xs font-normal text-muted">
                          {t("settings.usage.resolve.utcTime", {
                            date: submittedAt.utcDateTime,
                          })}
                        </span>
                      </>
                    ) : (
                      t("settings.usage.holds.noSubmittedAt")
                    )}
                  </dd>
                </div>
              </dl>
              <details className="mt-4 border-t border-line pt-3 text-xs">
                <summary className="cursor-pointer font-bold text-muted marker:text-line-strong hover:text-ink">
                  {t("settings.usage.resolve.viewRun")}
                </summary>
                <div className="mt-2 break-all font-medium text-ink">
                  <RunDiagnosticLink
                    workflowRunId={hold.workflowRunId}
                    capabilityRunId={hold.capabilityRunId}
                    workspaceId={workspaceId}
                  />
                  {hold.workflowRunId ? (
                    <code className="mt-1 block font-mono text-xs text-muted">
                      {hold.workflowRunId}
                    </code>
                  ) : null}
                </div>
              </details>
              <p
                aria-live="polite"
                className={
                  copyStatus === "failed"
                    ? "mt-3 text-xs leading-5 text-danger"
                    : "mt-3 text-xs leading-5 text-muted"
                }
                role="status"
              >
                {copyStatusLabel}
              </p>
            </div>
            <Form.Item
              className="!mt-5 !mb-0"
              label={t("settings.usage.resolve.externalRecord")}
              {...(fieldErrors.resolution
                ? {
                    help: fieldErrors.resolution,
                    validateStatus: "error" as const,
                  }
                : {})}
            >
              <Radio.Group
                aria-describedby={
                  fieldErrors.resolution ? resolutionErrorId : undefined
                }
                className="grid w-full gap-2 sm:grid-cols-2"
                disabled={mutation.isPending}
                onChange={handleResolutionChange}
                value={resolution}
              >
                <Radio id={`unknown-hold-${hold.id}-charged`} value="charged">
                  {t("settings.usage.resolve.chargedChoice")}
                </Radio>
                <Radio value="not_charged">
                  {t("settings.usage.resolve.notChargedChoice")}
                </Radio>
              </Radio.Group>
              {fieldErrors.resolution ? (
                <span className="sr-only" id={resolutionErrorId}>
                  {fieldErrors.resolution}
                </span>
              ) : null}
            </Form.Item>
            <div className="mt-5 grid gap-5">
              {resolution === "charged" ? (
                <Form.Item
                  className="!mb-0"
                  label={t("settings.usage.resolve.amountLabel", {
                    currency: hold.currencyCode,
                  })}
                  {...(fieldErrors.chargedAmount
                    ? {
                        help: fieldErrors.chargedAmount,
                        validateStatus: "error" as const,
                      }
                    : {})}
                >
                  <KanvasInput
                    autoComplete="off"
                    disabled={mutation.isPending}
                    id={chargedAmountId}
                    inputMode="decimal"
                    maxLength={50}
                    onChange={handleChargedAmountChange}
                    placeholder={t("settings.usage.resolve.amountPlaceholder")}
                    size="large"
                    value={chargedAmount}
                  />
                </Form.Item>
              ) : null}
              <Form.Item
                className="!mb-0"
                extra={t("settings.usage.resolve.referenceDescription")}
                label={t("settings.usage.resolve.referenceLabel")}
                {...(fieldErrors.evidenceReference
                  ? {
                      help: fieldErrors.evidenceReference,
                      validateStatus: "error" as const,
                    }
                  : {})}
              >
                <KanvasInput
                  autoComplete="off"
                  disabled={mutation.isPending}
                  id={evidenceReferenceId}
                  maxLength={240}
                  onChange={handleEvidenceReferenceChange}
                  placeholder={t("settings.usage.resolve.referencePlaceholder")}
                  size="large"
                  value={evidenceReference}
                />
              </Form.Item>
            </div>
            {formError ? (
              <InlineNotice
                className="mt-4"
                title={t("settings.usage.resolve.formErrorTitle")}
                tone="danger"
              >
                {formError}
              </InlineNotice>
            ) : null}
            {resolution ? (
              <p className="mt-5 rounded-control bg-mist px-4 py-3 text-xs leading-5 text-muted">
                {resolution === "charged"
                  ? t("settings.usage.resolve.chargedSummary", {
                      provider: hold.providerName,
                      amount: formatBudgetAmount(
                        hold.heldAmount,
                        hold.currencyCode,
                      ),
                    })
                  : t("settings.usage.resolve.releasedSummary", {
                      provider: hold.providerName,
                      amount: formatBudgetAmount(
                        hold.heldAmount,
                        hold.currencyCode,
                      ),
                    })}{" "}
                {t("settings.usage.resolve.auditDescription")}
              </p>
            ) : null}
            <div className="mt-7 flex flex-wrap justify-end gap-2">
              <Button
                disabled={mutation.isPending}
                onClick={requestResolutionClose}
                htmlType="button"
                type="text"
              >
                {t("settings.usage.resolve.cancel")}
              </Button>
              <Button
                disabled={!resolution}
                htmlType="submit"
                loading={mutation.isPending}
                type="primary"
              >
                {submitLabel}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        onOpenChange={(nextOpen) => {
          updateResolutionState({
            type: "discard_visibility_changed",
            open: nextOpen,
          });
        }}
        open={discardRequested}
      >
        <AlertDialogContent
          actionLabel={t("settings.usage.resolve.discardAction")}
          cancelLabel={t("settings.usage.resolve.cancel")}
          onAction={discardResolutionDraft}
          title={t("settings.usage.resolve.discardTitle")}
        >
          {t("settings.usage.resolve.discardDescription")}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function UsageMetrics({
  data,
}: {
  readonly data: WorkspaceUsageSummary;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="usage-metrics-title" className="mt-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-bold" id="usage-metrics-title">
            {t("settings.usage.metrics.title")}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {t("settings.usage.metrics.tracked", {
              count: data.trackedAttemptCount,
            })}
          </p>
        </div>
        {data.unknownUsageCount > 0 ? (
          <StatusBadge tone="warning">
            {t("settings.usage.metrics.unknown", {
              count: data.unknownUsageCount,
            })}
          </StatusBadge>
        ) : null}
      </div>
      {data.metrics.length === 0 ? (
        <div className="rounded-card bg-paper px-5 py-6 shadow-[0_8px_24px_rgb(35_32_68_/_5%)]">
          <strong className="block text-sm">
            {t("settings.usage.metrics.emptyTitle")}
          </strong>
          <p className="mt-1 text-sm leading-6 text-muted">
            {t("settings.usage.metrics.emptyDescription")}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <article className="rounded-[18px] bg-paper p-5 shadow-[0_10px_28px_rgb(35_32_68_/_5%)]">
            <span className="text-xs text-muted">
              {t("settings.usage.metrics.tasks")}
            </span>
            <strong className="mt-2 block text-[22px] tracking-[-0.02em] tabular-nums">
              {t("settings.usage.metrics.taskValue", {
                count: data.trackedAttemptCount,
              })}
            </strong>
          </article>
          {data.metrics.map((metric) => (
            <article
              className="rounded-[18px] bg-paper p-5 shadow-[0_10px_28px_rgb(35_32_68_/_5%)]"
              key={`${metric.metricKey}-${metric.dimension}-${metric.dimension === "quantity" ? metric.unitCode : metric.currencyCode}`}
            >
              <span className="text-xs text-muted">
                {usageMetricLabel(metric.metricKey)}
              </span>
              <strong className="mt-2 block text-[22px] tracking-[-0.02em] tabular-nums">
                {formatUsageMetric(metric)}
              </strong>
              <span className="mt-3 block text-xs text-muted">
                {metric.unknownCount > 0
                  ? t("settings.usage.metrics.unknownRow", {
                      count: metric.unknownCount,
                    })
                  : t("settings.usage.metrics.latestAt", {
                      date: fullDate(metric.lastRecordedAt),
                    })}
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
