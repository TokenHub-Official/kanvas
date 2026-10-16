import type {
  ProviderFixedPricingDocumentV1,
  ProviderMeteredPricingDocumentV1,
  ProviderPricingDocumentV1,
  ProviderPricingUnverifiedReason,
  ProviderReportedCharge,
  ProviderReportedPricingDocumentV1,
  ProviderUnverifiedPricingDocumentV1,
  ProviderVerifiedPricingEvidenceV1,
} from "@kanvas/contracts/provider-billing";

const unsignedDecimalPattern = /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u;
const unsignedIntegerPattern = /^(?:[1-9][0-9]{0,19})$/u;
const currencyCodePattern = /^[A-Z]{3}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const metricKeyPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const unitCodePattern = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
const sourceReferencePattern = /^[\x20-\x7e]{1,512}$/u;
const unverifiedReasons = new Set<ProviderPricingUnverifiedReason>([
  "provider_price_evidence_missing",
  "provider_price_evidence_stale",
  "manual_review_required",
]);

function invalid(message: string): never {
  throw new TypeError(message);
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

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  return isPlainObject(value)
    ? value
    : invalid(`${label} must be a plain object.`);
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(value);
  if (
    !required.every((key) => keys.includes(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    invalid("Provider pricing document has missing or unknown fields.");
  }
}

function decimal(value: unknown, label: string): string {
  return typeof value === "string" && unsignedDecimalPattern.test(value)
    ? value
    : invalid(`${label} must be an unsigned DECIMAL(36,12) string.`);
}

function isoTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") {
    return invalid(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    ? value
    : invalid(`${label} must be a canonical ISO-8601 UTC timestamp.`);
}

function verifiedEvidence(value: unknown): ProviderVerifiedPricingEvidenceV1 {
  const evidence = record(value, "Provider pricing evidence");
  exactKeys(evidence, [
    "priceVerified",
    "sourceKind",
    "sourceReference",
    "observedAt",
    "sourceDigest",
  ]);
  if (
    evidence.priceVerified !== true ||
    !["provider_documentation", "provider_api", "contract"].includes(
      String(evidence.sourceKind),
    ) ||
    typeof evidence.sourceReference !== "string" ||
    !sourceReferencePattern.test(evidence.sourceReference) ||
    typeof evidence.sourceDigest !== "string" ||
    !digestPattern.test(evidence.sourceDigest)
  ) {
    return invalid(
      "Verified Provider pricing evidence is invalid or untrusted.",
    );
  }
  return Object.freeze({
    priceVerified: true,
    sourceKind:
      evidence.sourceKind as ProviderVerifiedPricingEvidenceV1["sourceKind"],
    sourceReference: evidence.sourceReference,
    observedAt: isoTimestamp(
      evidence.observedAt,
      "Provider pricing evidence observedAt",
    ),
    sourceDigest: evidence.sourceDigest,
  });
}

function unverifiedPricing(
  value: Readonly<Record<string, unknown>>,
): ProviderUnverifiedPricingDocumentV1 {
  exactKeys(value, ["schemaVersion", "billingMode", "reason", "evidence"]);
  if (
    typeof value.reason !== "string" ||
    !unverifiedReasons.has(value.reason as ProviderPricingUnverifiedReason)
  ) {
    return invalid("Provider unverified pricing reason is invalid.");
  }
  const evidence = record(
    value.evidence,
    "Provider unverified pricing evidence",
  );
  exactKeys(evidence, [
    "priceVerified",
    "sourceKind",
    "sourceReference",
    "maximumChargeRole",
    "revisionVerifiedAtRole",
  ]);
  if (
    evidence.priceVerified !== false ||
    evidence.sourceKind !== "unverified" ||
    evidence.sourceReference !== "none" ||
    evidence.maximumChargeRole !== "risk_ceiling_only" ||
    evidence.revisionVerifiedAtRole !== "risk_ceiling_reviewed_at"
  ) {
    return invalid("Provider unverified pricing evidence boundary is invalid.");
  }
  return Object.freeze({
    schemaVersion: 1,
    billingMode: "unverified",
    reason: value.reason as ProviderPricingUnverifiedReason,
    evidence: Object.freeze({
      priceVerified: false,
      sourceKind: "unverified",
      sourceReference: "none",
      maximumChargeRole: "risk_ceiling_only",
      revisionVerifiedAtRole: "risk_ceiling_reviewed_at",
    }),
  });
}

function fixedPricing(
  value: Readonly<Record<string, unknown>>,
): ProviderFixedPricingDocumentV1 {
  exactKeys(value, [
    "schemaVersion",
    "billingMode",
    "fixedChargeAmount",
    "evidence",
  ]);
  return Object.freeze({
    schemaVersion: 1,
    billingMode: "fixed",
    fixedChargeAmount: decimal(
      value.fixedChargeAmount,
      "Provider fixed charge",
    ),
    evidence: verifiedEvidence(value.evidence),
  });
}

function meteredPricing(
  value: Readonly<Record<string, unknown>>,
): ProviderMeteredPricingDocumentV1 {
  exactKeys(
    value,
    ["schemaVersion", "billingMode", "rates", "evidence"],
    ["minimumChargeAmount"],
  );
  if (
    !Array.isArray(value.rates) ||
    value.rates.length < 1 ||
    value.rates.length > 32
  ) {
    return invalid("Provider metered pricing rates are invalid.");
  }
  const metricKeys = new Set<string>();
  const rates = value.rates.map((rawRate, index) => {
    const rate = record(rawRate, `Provider pricing rate ${String(index)}`);
    exactKeys(rate, ["metricKey", "unitCode", "quantity", "amount"]);
    if (
      typeof rate.metricKey !== "string" ||
      !metricKeyPattern.test(rate.metricKey) ||
      typeof rate.unitCode !== "string" ||
      !unitCodePattern.test(rate.unitCode) ||
      typeof rate.quantity !== "string" ||
      !unsignedIntegerPattern.test(rate.quantity) ||
      metricKeys.has(rate.metricKey)
    ) {
      return invalid(
        `Provider pricing rate ${String(index)} is invalid or duplicated.`,
      );
    }
    metricKeys.add(rate.metricKey);
    return Object.freeze({
      metricKey: rate.metricKey,
      unitCode: rate.unitCode,
      quantity: rate.quantity,
      amount: decimal(
        rate.amount,
        `Provider pricing rate ${String(index)} amount`,
      ),
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    billingMode: "metered",
    rates: Object.freeze(rates),
    ...(value.minimumChargeAmount === undefined
      ? {}
      : {
          minimumChargeAmount: decimal(
            value.minimumChargeAmount,
            "Provider minimum charge",
          ),
        }),
    evidence: verifiedEvidence(value.evidence),
  });
}

function providerReportedPricing(
  value: Readonly<Record<string, unknown>>,
): ProviderReportedPricingDocumentV1 {
  exactKeys(value, [
    "schemaVersion",
    "billingMode",
    "currencyCode",
    "evidence",
  ]);
  if (
    typeof value.currencyCode !== "string" ||
    !currencyCodePattern.test(value.currencyCode)
  ) {
    return invalid("Provider-reported pricing currency is invalid.");
  }
  const evidence = record(value.evidence, "Provider-reported pricing evidence");
  exactKeys(evidence, [
    "chargeVerified",
    "sourceKind",
    "sourceReference",
    "observedAt",
    "sourceDigest",
  ]);
  if (
    evidence.chargeVerified !== true ||
    (evidence.sourceKind !== "provider_api" &&
      evidence.sourceKind !== "contract") ||
    typeof evidence.sourceReference !== "string" ||
    !sourceReferencePattern.test(evidence.sourceReference) ||
    typeof evidence.sourceDigest !== "string" ||
    !digestPattern.test(evidence.sourceDigest)
  ) {
    return invalid("Provider-reported pricing evidence is invalid.");
  }
  return Object.freeze({
    schemaVersion: 1,
    billingMode: "provider_reported",
    currencyCode: value.currencyCode,
    evidence: Object.freeze({
      chargeVerified: true,
      sourceKind: evidence.sourceKind,
      sourceReference: evidence.sourceReference,
      observedAt: isoTimestamp(
        evidence.observedAt,
        "Provider-reported pricing evidence observedAt",
      ),
      sourceDigest: evidence.sourceDigest,
    }),
  });
}

export function parseProviderPricingDocumentV1(
  value: unknown,
): ProviderPricingDocumentV1 {
  const pricing = record(value, "Provider pricing document");
  if (pricing.schemaVersion !== 1) {
    return invalid("Provider pricing schemaVersion must be 1.");
  }
  if (pricing.billingMode === "unverified") {
    return unverifiedPricing(pricing);
  }
  if (pricing.billingMode === "fixed") {
    return fixedPricing(pricing);
  }
  if (pricing.billingMode === "metered") {
    return meteredPricing(pricing);
  }
  if (pricing.billingMode === "provider_reported") {
    return providerReportedPricing(pricing);
  }
  return invalid("Provider pricing billingMode is unsupported.");
}

export function buildUnverifiedProviderPricingDocumentV1(
  reason: ProviderPricingUnverifiedReason,
): ProviderUnverifiedPricingDocumentV1 {
  return unverifiedPricing({
    schemaVersion: 1,
    billingMode: "unverified",
    reason,
    evidence: {
      priceVerified: false,
      sourceKind: "unverified",
      sourceReference: "none",
      maximumChargeRole: "risk_ceiling_only",
      revisionVerifiedAtRole: "risk_ceiling_reviewed_at",
    },
  });
}

export function parseProviderReportedCharge(
  value: unknown,
): ProviderReportedCharge {
  const charge = record(value, "Provider reported charge");
  exactKeys(charge, ["source", "currencyCode", "amount"]);
  if (
    charge.source !== "provider_reported" ||
    typeof charge.currencyCode !== "string" ||
    !currencyCodePattern.test(charge.currencyCode)
  ) {
    return invalid(
      "Provider reported charge source or ISO-style currency is invalid.",
    );
  }
  return Object.freeze({
    source: "provider_reported",
    currencyCode: charge.currencyCode,
    amount: decimal(charge.amount, "Provider reported charge amount"),
  });
}
