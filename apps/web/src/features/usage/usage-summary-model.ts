import type {
  WorkspaceBudgetSummary,
  WorkspaceUnknownBudgetHold,
  WorkspaceUsageSummary,
} from "@kanvas/contracts/api";
import { i18n } from "../../i18n/i18n.js";

const MILLISECONDS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;
const MAXIMUM_PERCENT = 100;

const metricLabelKeys: Readonly<Record<string, string>> = {
  "compute.wall_time": "duration",
  duration: "duration",
  duration_ms: "duration",
  input_tokens: "inputTokens",
  input_text_tokens: "inputTextTokens",
  input_image_tokens: "inputImageTokens",
  output_tokens: "outputTokens",
  total_tokens: "totalTokens",
  cost: "cost",
};

const unitLabelKeys: Readonly<Record<string, string>> = {
  millisecond: "milliseconds",
  milliseconds: "milliseconds",
  ms: "milliseconds",
  second: "seconds",
  seconds: "seconds",
  token: "tokens",
  tokens: "tokens",
  byte: "bytes",
  bytes: "bytes",
};

export function usageMetricLabel(metricKey: string): string {
  const key = metricLabelKeys[metricKey];
  return key
    ? i18n.t(`settings.usage.metricLabels.${key}`)
    : i18n.t("settings.usage.metricLabels.other");
}

function compactNumber(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return value;
  }
  return new Intl.NumberFormat(i18n.resolvedLanguage, {
    maximumFractionDigits: 2,
  }).format(number);
}

function formatMilliseconds(value: string): string {
  const milliseconds = Number(value);
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds < MILLISECONDS_PER_SECOND
  ) {
    return i18n.t("settings.usage.duration.milliseconds", {
      value: compactNumber(value),
    });
  }
  const roundedSeconds = Math.round(milliseconds / MILLISECONDS_PER_SECOND);
  const hours = Math.floor(roundedSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor(
    (roundedSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE,
  );
  const seconds = roundedSeconds % SECONDS_PER_MINUTE;
  return [
    hours > 0
      ? i18n.t("settings.usage.duration.hours", {
          value: hours,
        })
      : undefined,
    minutes > 0
      ? i18n.t("settings.usage.duration.minutes", {
          value: minutes,
        })
      : undefined,
    seconds > 0 || (hours === 0 && minutes === 0)
      ? i18n.t("settings.usage.duration.seconds", {
          value: seconds,
        })
      : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

export function formatUsageMetric(
  metric: WorkspaceUsageSummary["metrics"][number],
): string {
  if (metric.dimension === "money") {
    return new Intl.NumberFormat(i18n.resolvedLanguage, {
      style: "currency",
      currency: metric.currencyCode,
      maximumFractionDigits: 4,
    }).format(Number(metric.value));
  }
  if (
    metric.unitCode === "millisecond" ||
    metric.unitCode === "milliseconds" ||
    metric.unitCode === "ms"
  ) {
    return formatMilliseconds(metric.value);
  }
  const unitKey = unitLabelKeys[metric.unitCode];
  return `${compactNumber(metric.value)} ${
    unitKey ? i18n.t(`settings.usage.units.${unitKey}`) : metric.unitCode
  }`;
}

export function formatBudgetAmount(
  value: string,
  currencyCode: string,
): string {
  return new Intl.NumberFormat(i18n.resolvedLanguage, {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export interface ReconciliationTimestamp {
  readonly localDateTime: string;
  readonly localZone: string;
  readonly utcDateTime: string;
}

function dateTimeParts(
  value: Date,
  timeZone: string,
  includeZone: boolean,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone,
      ...(includeZone ? { timeZoneName: "shortOffset" as const } : {}),
    })
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  );
}

function joinedDateTime(parts: Readonly<Record<string, string>>): string {
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function reconciliationTimestamp(
  value: string,
  localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ReconciliationTimestamp | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || localTimeZone.trim().length === 0) {
    return undefined;
  }
  try {
    const local = dateTimeParts(date, localTimeZone, true);
    const utc = dateTimeParts(date, "UTC", false);
    return Object.freeze({
      localDateTime: joinedDateTime(local),
      localZone:
        local.timeZoneName === "GMT"
          ? "UTC"
          : (local.timeZoneName ?? localTimeZone),
      utcDateTime: joinedDateTime(utc),
    });
  } catch {
    return undefined;
  }
}

export function budgetConsumptionPercent(
  budget: WorkspaceBudgetSummary,
): number {
  const limit = Number(budget.hardLimitAmount);
  if (!Number.isFinite(limit) || limit <= 0) {
    return 0;
  }
  const unavailable = budgetUnavailableAmount(budget);
  return Math.min(
    MAXIMUM_PERCENT,
    Math.max(0, (unavailable / limit) * MAXIMUM_PERCENT),
  );
}

export function budgetUnavailableAmount(
  budget: WorkspaceBudgetSummary,
): number {
  return (
    Number(budget.consumedAmount) +
    Number(budget.reservedAmount) +
    Number(budget.unknownHeldAmount)
  );
}

export function reconciliationEvidenceSummary(
  hold: WorkspaceUnknownBudgetHold,
  localTimeZone?: string,
): string {
  const submittedAt = hold.submittedAt
    ? reconciliationTimestamp(hold.submittedAt, localTimeZone)
    : undefined;
  return [
    i18n.t("settings.usage.evidence.provider", {
      value: hold.providerName,
    }),
    i18n.t("settings.usage.evidence.amount", {
      value: formatBudgetAmount(hold.heldAmount, hold.currencyCode),
    }),
    i18n.t("settings.usage.evidence.run", {
      value: hold.workflowRunId ?? i18n.t("settings.usage.notLinked"),
    }),
    i18n.t("settings.usage.evidence.externalTask", {
      value:
        hold.providerRequestId ?? i18n.t("settings.usage.holds.noExternalTask"),
    }),
    i18n.t("settings.usage.evidence.localTime", {
      value: submittedAt
        ? `${submittedAt.localDateTime} ${submittedAt.localZone}`
        : i18n.t("settings.usage.holds.noSubmittedAt"),
    }),
    i18n.t("settings.usage.evidence.utcTime", {
      value: submittedAt
        ? `${submittedAt.utcDateTime} UTC`
        : i18n.t("settings.usage.holds.noSubmittedAt"),
    }),
  ].join("\n");
}
