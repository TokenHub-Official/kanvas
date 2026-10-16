import type { OperationalTimeline } from "@kanvas/contracts/api";

import type { StatusBadgeTone } from "../../components/status-badge.js";
import { i18n } from "../../i18n/i18n.js";

export type OperationalTimelineItem = OperationalTimeline["items"][number];

const stateLabelKeys: Record<string, string> = {
  queued: "queued",
  running: "running",
  waiting: "waiting",
  cancelling: "cancelling",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  succeeded: "succeeded",
  full_success: "succeeded",
  partial_success: "partialSuccess",
  no_usable_output: "noUsableOutput",
  retryable: "retryable",
  non_retryable: "nonRetryable",
  available: "available",
  committed: "committed",
  active: "active",
  terminal: "terminal",
};

const executionTargetLabelKeys: Record<string, string> = {
  browser: "browser",
  worker: "worker",
  provider: "provider",
};

const responseStructureKindLabelKeys: Record<string, string> = {
  u: "missing",
  n: "null",
  s: "string",
  b: "boolean",
  i: "integer",
  f: "number",
  a: "array",
  o: "object",
  x: "other",
};

const responseStructureFieldLabels = {
  r: {
    c: "code",
    d: "data",
    e: "error",
    m: "message",
    t: "task_id",
    s: "status",
  },
  d: {
    t: "task_id",
    s: "status",
    r: "result_urls",
    u: "updated_at",
    c: "created_at",
    e: "error",
    m: "message",
  },
} as const;

function factText(
  item: OperationalTimelineItem,
  key: string,
): string | undefined {
  const value = item.facts[key];
  return value === null || value === undefined ? undefined : String(value);
}

export function operationalStateLabel(
  value?: string | null,
): string | undefined {
  if (!value) {
    return undefined;
  }
  const key = stateLabelKeys[value];
  return key ? i18n.t(`operations.states.${key}`) : value;
}

export function operationalResponseStructureSummary(
  item: OperationalTimelineItem,
): string | undefined {
  if (item.source !== "provider_observation") {
    return undefined;
  }
  const value = factText(item, "responseStructure");
  if (!value || !/^[a-z0-9][a-z0-9.-]{0,63}$/u.test(value)) {
    return undefined;
  }
  const [scopeToken, ...fieldTokens] = value.split(".");
  const scopeMatch = /^(r|d)-([a-z])$/u.exec(scopeToken ?? "");
  if (!scopeMatch) {
    return undefined;
  }
  const scope = scopeMatch[1] as "r" | "d";
  const scopeKindKey = responseStructureKindLabelKeys[scopeMatch[2] ?? ""];
  if (!scopeKindKey) {
    return undefined;
  }
  const labels = responseStructureFieldLabels[scope];
  const expectedAliases =
    scope === "r"
      ? ["c", "d", "e", "m", "t", "s", "x"]
      : ["t", "s", "r", "u", "c", "e", "m", "x"];
  if (
    fieldTokens.length === 0 &&
    (scope !== "r" || scopeKindKey === "object")
  ) {
    return undefined;
  }
  if (
    fieldTokens.length > 0 &&
    (fieldTokens.length !== expectedAliases.length ||
      fieldTokens.some(
        (token, index) => token.split("-", 1)[0] !== expectedAliases[index],
      ))
  ) {
    return undefined;
  }
  const present: string[] = [];
  const missing: string[] = [];
  let otherCount: number | undefined;
  for (const token of fieldTokens) {
    const match = /^([a-z])-([a-z0-9])$/u.exec(token);
    if (!match) {
      return undefined;
    }
    const alias = match[1] ?? "";
    const kind = match[2] ?? "";
    if (alias === "x") {
      const count = Number(kind);
      if (!Number.isSafeInteger(count)) {
        return undefined;
      }
      otherCount = count;
      continue;
    }
    const label = labels[alias as keyof typeof labels];
    const kindLabelKey = responseStructureKindLabelKeys[kind];
    if (!label || !kindLabelKey) {
      return undefined;
    }
    if (kind === "u") {
      missing.push(label);
    } else {
      present.push(
        i18n.t("operations.structure.present", {
          field: label,
          kind: i18n.t(`operations.structure.kinds.${kindLabelKey}`),
        }),
      );
    }
  }
  return [
    i18n.t("operations.structure.scope", {
      scope: i18n.t(
        scope === "r"
          ? "operations.structure.root"
          : "operations.structure.data",
      ),
      kind: i18n.t(`operations.structure.kinds.${scopeKindKey}`),
    }),
    ...present,
    missing.length > 0
      ? i18n.t("operations.structure.missing", {
          fields: missing.join(i18n.t("operations.structure.listSeparator")),
        })
      : undefined,
    otherCount === undefined
      ? undefined
      : i18n.t("operations.structure.otherFields", {
          count: otherCount,
        }),
  ]
    .filter(Boolean)
    .join(i18n.t("operations.structure.separator"));
}

export function operationalEventTone(
  item: OperationalTimelineItem,
): StatusBadgeTone {
  const value = `${item.status ?? ""} ${item.outcome ?? ""}`.toLowerCase();
  if (/failed|error|denied|rejected|no_usable|invalid/u.test(value)) {
    return "danger";
  }
  if (/waiting|cancell|partial|retry|unknown|held|expired/u.test(value)) {
    return "warning";
  }
  if (
    /completed|succeeded|full_success|available|committed|accepted/u.test(value)
  ) {
    return "positive";
  }
  return "neutral";
}

export function isOperationalIssue(item: OperationalTimelineItem): boolean {
  const tone = operationalEventTone(item);
  return tone === "danger" || tone === "warning";
}

export function operationalEventTitle(item: OperationalTimelineItem): string {
  if (item.kind === "provider.result_policy.checked")
    return i18n.t(
      item.outcome === "allowed"
        ? "operations.resultPolicy.allowed"
        : "operations.resultPolicy.blocked",
    );
  const state = operationalStateLabel(item.outcome ?? item.status);
  const title = (key: string, fallback: string) =>
    i18n.t(`operations.events.${key}`, {
      defaultValue: fallback,
    });
  const withState = (label: string) =>
    state
      ? i18n.t("operations.events.withState", {
          label,
          state,
        })
      : label;
  switch (item.source) {
    case "workflow_run":
      return withState(title("workflow", "工作流"));
    case "node_run":
      return withState(factText(item, "nodeKey") ?? title("node", "流程节点"));
    case "capability_run":
      return withState(title("capability", "能力执行"));
    case "capability_attempt": {
      const attemptNumber = factText(item, "attemptNumber");
      return withState(
        attemptNumber
          ? i18n.t("operations.events.attemptNumber", {
              number: attemptNumber,
            })
          : title("attempt", "执行尝试"),
      );
    }
    case "outbox_event":
      return withState(title("outbox", "任务事件投递"));
    case "inbox_receipt":
      return withState(title("inbox", "任务事件处理"));
    case "provider_invocation":
      return withState(title("providerCall", "模型调用"));
    case "provider_observation":
      return withState(title("providerObservation", "模型状态更新"));
    case "usage_ledger":
      return title("usage", "记录用量");
    case "budget_reservation":
      return withState(title("budgetReservation", "额度预留"));
    case "budget_ledger":
      return title("budgetLedger", "额度结算更新");
    case "artifact_commit":
      return withState(title("artifact", "结果入库"));
    case "audit_event":
      return withState(title("audit", "操作审计"));
  }
}

export function operationalEventSummary(
  item: OperationalTimelineItem,
): string | undefined {
  if (item.kind === "provider.result_policy.checked")
    return [
      factText(item, "resultOrigin"),
      i18n.t("operations.resultPolicy.source", {
        source: factText(item, "policySource"),
        version: factText(item, "policyVersion") ?? "—",
      }),
      item.outcome === "allowed" ? undefined : item.outcome,
    ]
      .filter(Boolean)
      .join(" · ");
  switch (item.source) {
    case "capability_attempt": {
      const target = factText(item, "executionTarget");
      return target
        ? i18n.t("operations.summary.executionTarget", {
            target: executionTargetLabelKeys[target]
              ? i18n.t(`operations.targets.${executionTargetLabelKeys[target]}`)
              : target,
          })
        : undefined;
    }
    case "node_run":
      return factText(item, "waitingReason")
        ? i18n.t("operations.summary.waitingReason", {
            reason: factText(item, "waitingReason"),
          })
        : undefined;
    case "provider_invocation": {
      const provider = factText(item, "providerKey");
      const workState = factText(item, "workState");
      return (
        [
          provider && i18n.t("operations.summary.provider", { provider }),
          workState,
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      );
    }
    case "provider_observation": {
      const errorCode = item.outcome ?? factText(item, "stableErrorCode");
      const hasResponseStructure =
        operationalResponseStructureSummary(item) !== undefined;
      return (
        [
          errorCode
            ? i18n.t("operations.summary.observation", {
                code: errorCode,
              })
            : undefined,
          hasResponseStructure
            ? i18n.t("operations.summary.safeStructure")
            : undefined,
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      );
    }
    case "usage_ledger": {
      const metric = factText(item, "metricKey");
      const value = factText(item, "numericValue");
      const unit = factText(item, "unitCode");
      return [metric, value, unit].filter(Boolean).join(" · ") || undefined;
    }
    case "budget_reservation": {
      const reserved = factText(item, "reservedAmount");
      const currency = factText(item, "currencyCode");
      return reserved
        ? i18n.t("operations.summary.reserved", {
            amount: reserved,
            currency: currency ? ` ${currency}` : "",
          })
        : undefined;
    }
    case "artifact_commit": {
      const mediaType = factText(item, "mediaType");
      const outputRole = factText(item, "outputRole");
      return [outputRole, mediaType].filter(Boolean).join(" · ") || undefined;
    }
    case "audit_event": {
      const action = factText(item, "action");
      return action
        ? i18n.t("operations.summary.action", { action })
        : undefined;
    }
    default:
      return undefined;
  }
}
