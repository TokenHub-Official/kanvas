import { parseProviderPricingDocumentV1 } from "@kanvas/application";
import {
  decimalToUnits,
  decimalUnitsToString,
  FixedDecimalError,
} from "@kanvas/database/runtime";
import type {
  ProviderFixedPricingDocumentV1,
  ProviderMeteredPricingDocumentV1,
  ProviderReportedCharge,
} from "@kanvas/contracts/provider-billing";

import {
  ProviderAdapterContractError,
  type ProviderUsageMetric,
} from "./provider-adapter.js";

const unsignedIntegerPattern = /^(?:[1-9][0-9]{0,19})$/u;
const metricKeyPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const unitCodePattern = /^[a-z0-9][a-z0-9._-]{0,39}$/u;

export type ProviderChargeCalculation =
  | {
      readonly status: "calculated";
      readonly amount: string;
    }
  | {
      readonly status: "unknown";
      readonly reason:
        | "pricing_schema_unsupported"
        | "pricing_unverified"
        | "pricing_evidence_missing"
        | "usage_missing"
        | "provider_charge_missing";
    };

function contract(message: string, cause?: unknown): never {
  const error = new ProviderAdapterContractError(message);
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", {
      configurable: true,
      enumerable: false,
      value: cause,
    });
  }
  throw error;
}

function isPlainObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function amountUnits(value: unknown, label: string): bigint {
  try {
    return decimalToUnits(value, label);
  } catch (error) {
    if (error instanceof FixedDecimalError) {
      return contract(`Provider pricing ${label} is invalid.`, error);
    }
    throw error;
  }
}

function fixedCharge(
  pricing: ProviderFixedPricingDocumentV1,
): ProviderChargeCalculation {
  return Object.freeze({
    status: "calculated",
    amount: decimalUnitsToString(
      amountUnits(pricing.fixedChargeAmount, "fixedChargeAmount"),
    ),
  });
}

function meteredCharge(
  pricing: ProviderMeteredPricingDocumentV1,
  usage: readonly ProviderUsageMetric[],
): ProviderChargeCalculation {
  const usageByMetric = new Map(
    usage.map((metric) => [metric.metricKey, metric]),
  );
  const rateMetrics = new Set<string>();
  let total = 0n;
  for (const [index, rawRate] of pricing.rates.entries()) {
    if (
      !isPlainObject(rawRate) ||
      !exactKeys(rawRate, ["metricKey", "unitCode", "quantity", "amount"]) ||
      typeof rawRate.metricKey !== "string" ||
      !metricKeyPattern.test(rawRate.metricKey) ||
      typeof rawRate.unitCode !== "string" ||
      !unitCodePattern.test(rawRate.unitCode) ||
      typeof rawRate.quantity !== "string" ||
      !unsignedIntegerPattern.test(rawRate.quantity) ||
      rateMetrics.has(rawRate.metricKey)
    ) {
      return contract(
        `Provider pricing rate ${String(index)} is invalid or duplicated.`,
      );
    }
    rateMetrics.add(rawRate.metricKey);
    const metric = usageByMetric.get(rawRate.metricKey);
    if (!metric || metric.unitCode !== rawRate.unitCode) {
      return Object.freeze({
        status: "unknown",
        reason: "usage_missing",
      });
    }
    const quantity = BigInt(metric.numericValue);
    const rateQuantity = BigInt(rawRate.quantity);
    const rateAmount = amountUnits(
      rawRate.amount,
      `rates[${String(index)}].amount`,
    );
    const numerator = quantity * rateAmount;
    total +=
      numerator === 0n ? 0n : (numerator + rateQuantity - 1n) / rateQuantity;
  }
  if (pricing.minimumChargeAmount !== undefined) {
    const minimum = amountUnits(
      pricing.minimumChargeAmount,
      "minimumChargeAmount",
    );
    if (minimum > total) {
      total = minimum;
    }
  }
  let amount: string;
  try {
    amount = decimalUnitsToString(total);
  } catch (error) {
    if (error instanceof FixedDecimalError) {
      return contract(
        "Calculated Provider charge exceeds DECIMAL(36,12).",
        error,
      );
    }
    throw error;
  }
  return Object.freeze({
    status: "calculated",
    amount,
  });
}

export function calculateProviderCharge(
  pricing: Readonly<Record<string, unknown>>,
  usage: readonly ProviderUsageMetric[],
): ProviderChargeCalculation {
  if (
    pricing.schemaVersion !== 1 ||
    !["unverified", "fixed", "metered", "provider_reported"].includes(
      String(pricing.billingMode),
    )
  ) {
    return Object.freeze({
      status: "unknown",
      reason: "pricing_schema_unsupported",
    });
  }
  if (
    (pricing.billingMode === "fixed" ||
      pricing.billingMode === "metered" ||
      pricing.billingMode === "provider_reported") &&
    !Object.hasOwn(pricing, "evidence")
  ) {
    return Object.freeze({
      status: "unknown",
      reason: "pricing_evidence_missing",
    });
  }
  let parsed;
  try {
    parsed = parseProviderPricingDocumentV1(pricing);
  } catch (error) {
    return contract(
      error instanceof Error
        ? `Provider pricing document is invalid: ${error.message}`
        : "Provider pricing document is invalid.",
      error,
    );
  }
  if (parsed.billingMode === "unverified") {
    return Object.freeze({
      status: "unknown",
      reason: "pricing_unverified",
    });
  }
  if (parsed.billingMode === "provider_reported") {
    return Object.freeze({
      status: "unknown",
      reason: "provider_charge_missing",
    });
  }
  return parsed.billingMode === "fixed"
    ? fixedCharge(parsed)
    : meteredCharge(parsed, usage);
}

export function resolveProviderCapturedAmount(options: {
  readonly pricing: Readonly<Record<string, unknown>>;
  readonly usage: readonly ProviderUsageMetric[];
  readonly reportedCharge?: ProviderReportedCharge;
  readonly currencyCode: string;
  readonly maximumChargeAmount: string;
}): string | undefined {
  const maximum = decimalToUnits(
    options.maximumChargeAmount,
    "provider maximum charge",
  );
  if (
    options.reportedCharge?.currencyCode === options.currencyCode &&
    decimalToUnits(options.reportedCharge.amount, "provider reported charge") <=
      maximum
  ) {
    return options.reportedCharge.amount;
  }
  if (options.reportedCharge) return undefined;
  const calculation = calculateProviderCharge(options.pricing, options.usage);
  return calculation.status === "calculated" &&
    decimalToUnits(calculation.amount, "provider calculated charge") <= maximum
    ? calculation.amount
    : undefined;
}
