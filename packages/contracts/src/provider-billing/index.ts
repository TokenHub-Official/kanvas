export type ProviderPricingUnverifiedReason =
  | "provider_price_evidence_missing"
  | "provider_price_evidence_stale"
  | "manual_review_required";

/**
 * An unverified PricingRevision is still a valid immutable budget pin. It
 * does not constitute price evidence and must never be used to calculate a
 * charge.
 */
export interface ProviderUnverifiedPricingEvidenceV1 {
  readonly priceVerified: false;
  readonly sourceKind: "unverified";
  readonly sourceReference: "none";
  readonly maximumChargeRole: "risk_ceiling_only";
  readonly revisionVerifiedAtRole: "risk_ceiling_reviewed_at";
}

export interface ProviderUnverifiedPricingDocumentV1 {
  readonly schemaVersion: 1;
  readonly billingMode: "unverified";
  readonly reason: ProviderPricingUnverifiedReason;
  readonly evidence: ProviderUnverifiedPricingEvidenceV1;
}

export type ProviderVerifiedPricingSourceKind =
  "provider_documentation" | "provider_api" | "contract";

export interface ProviderVerifiedPricingEvidenceV1 {
  readonly priceVerified: true;
  readonly sourceKind: ProviderVerifiedPricingSourceKind;
  readonly sourceReference: string;
  readonly observedAt: string;
  readonly sourceDigest: string;
}

export interface ProviderFixedPricingDocumentV1 {
  readonly schemaVersion: 1;
  readonly billingMode: "fixed";
  readonly fixedChargeAmount: string;
  readonly evidence: ProviderVerifiedPricingEvidenceV1;
}

export interface ProviderMeteredPricingRateV1 {
  readonly metricKey: string;
  readonly unitCode: string;
  readonly quantity: string;
  readonly amount: string;
}

export interface ProviderMeteredPricingDocumentV1 {
  readonly schemaVersion: 1;
  readonly billingMode: "metered";
  readonly rates: readonly ProviderMeteredPricingRateV1[];
  readonly minimumChargeAmount?: string;
  readonly evidence: ProviderVerifiedPricingEvidenceV1;
}

export interface ProviderReportedPricingEvidenceV1 {
  readonly chargeVerified: true;
  readonly sourceKind: "provider_api" | "contract";
  readonly sourceReference: string;
  readonly observedAt: string;
  readonly sourceDigest: string;
}

/**
 * The Provider reports the exact monetary charge for each successful request.
 * The pinned evidence proves the response-field contract; the runtime still
 * validates every reported amount against currency and maximum-charge bounds.
 */
export interface ProviderReportedPricingDocumentV1 {
  readonly schemaVersion: 1;
  readonly billingMode: "provider_reported";
  readonly currencyCode: string;
  readonly evidence: ProviderReportedPricingEvidenceV1;
}

export type ProviderPricingDocumentV1 =
  | ProviderUnverifiedPricingDocumentV1
  | ProviderFixedPricingDocumentV1
  | ProviderMeteredPricingDocumentV1
  | ProviderReportedPricingDocumentV1;

/**
 * Monetary cost explicitly reported by a trusted Provider Adapter. This is a
 * money fact, not a quantity usage metric.
 */
export interface ProviderReportedCharge {
  readonly source: "provider_reported";
  readonly currencyCode: string;
  readonly amount: string;
}
