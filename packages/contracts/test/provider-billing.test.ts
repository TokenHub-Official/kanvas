import type {
  ProviderPricingDocumentV1,
  ProviderReportedCharge,
} from "@kanvas/contracts/provider-billing";
import { describe, expect, it } from "vitest";

describe("Provider billing contract", () => {
  it("keeps an unverified budget pin distinct from a provider-reported monetary fact", () => {
    const pricing = {
      schemaVersion: 1,
      billingMode: "unverified",
      reason: "provider_price_evidence_missing",
      evidence: {
        priceVerified: false,
        sourceKind: "unverified",
        sourceReference: "none",
        maximumChargeRole: "risk_ceiling_only",
        revisionVerifiedAtRole: "risk_ceiling_reviewed_at",
      },
    } satisfies ProviderPricingDocumentV1;
    const reportedCharge = {
      source: "provider_reported",
      currencyCode: "USD",
      amount: "0.75",
    } satisfies ProviderReportedCharge;

    expect(pricing.billingMode).toBe("unverified");
    expect(reportedCharge).toEqual({
      source: "provider_reported",
      currencyCode: "USD",
      amount: "0.75",
    });
  });
});
