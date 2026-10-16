import type { KanvasAgentModelReportedCharge } from "@kanvas/agent-runtime";
import {
  normalizeUnsignedDecimal,
  type ResolvedAgentModelBinding,
} from "@kanvas/database/runtime";

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function decimalAmount(value: unknown): string | undefined {
  try {
    if (typeof value === "string") {
      return normalizeUnsignedDecimal(value, "Provider reported charge");
    }
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return normalizeUnsignedDecimal(
        value.toFixed(12),
        "Provider reported charge",
      );
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function usdTicks(value: unknown): string | undefined {
  if (!(
    (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  )) {
    return undefined;
  }
  const ticks = BigInt(value);
  const scale = 10_000_000_000n;
  const whole = ticks / scale;
  const fraction = (ticks % scale)
    .toString()
    .padStart(10, "0")
    .replace(/0+$/u, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

export function agentProviderReportedCharge(
  route: ResolvedAgentModelBinding,
  rawUsage: unknown,
): KanvasAgentModelReportedCharge | undefined {
  const usage = record(rawUsage);
  if (route.endpoint.presetKind === "xai") {
    const amount = usdTicks(usage?.cost_in_usd_ticks);
    return amount ? Object.freeze({ currencyCode: "USD", amount }) : undefined;
  }
  if (route.endpoint.presetKind === "openrouter") {
    const amount = decimalAmount(usage?.cost);
    return amount ? Object.freeze({ currencyCode: "USD", amount }) : undefined;
  }
  return undefined;
}

export interface TokenHubAsyncTaskBilling {
  readonly quota: string;
  readonly reportedCharge: KanvasAgentModelReportedCharge;
}

export function tokenHubAsyncTaskBilling(
  taskData: Readonly<Record<string, unknown>>,
): TokenHubAsyncTaskBilling | undefined {
  if (taskData.quota === undefined) return undefined;
  if (
    typeof taskData.quota !== "number" ||
    !Number.isSafeInteger(taskData.quota) ||
    taskData.quota < 0
  ) {
    throw new TypeError("TokenHub task quota must be a non-negative integer.");
  }
  const quota = BigInt(taskData.quota);
  const quotaPerUsd = 500_000n;
  const whole = quota / quotaPerUsd;
  const fraction = ((quota % quotaPerUsd) * 1_000_000n) / quotaPerUsd;
  const fractionText = fraction.toString().padStart(6, "0").replace(/0+$/u, "");
  const amount = fractionText
    ? `${whole.toString()}.${fractionText}`
    : whole.toString();
  return Object.freeze({
    quota: quota.toString(),
    reportedCharge: Object.freeze({ currencyCode: "USD", amount }),
  });
}
