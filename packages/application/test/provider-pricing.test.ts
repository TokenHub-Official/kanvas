import { describe, expect, it } from "vitest";

import {
  buildUnverifiedProviderPricingDocumentV1,
  parseProviderPricingDocumentV1,
  parseProviderReportedCharge,
} from "../src/modules/configuration/provider-pricing.js";

const verifiedEvidence = Object.freeze({
  priceVerified: true,
  sourceKind: "provider_api",
  sourceReference: "provider.billing.response",
  observedAt: "2026-08-12T12:00:00.000Z",
  sourceDigest: `sha256:${"a".repeat(64)}`,
});

describe("Provider pricing contracts", () => {
  it("makes an unverified revision explicit about both timestamp and maximum-charge semantics", () => {
    expect(
      buildUnverifiedProviderPricingDocumentV1(
        "provider_price_evidence_missing",
      ),
    ).toEqual({
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
    });
  });

  it("requires trusted evidence for fixed and metered price calculations", () => {
    expect(
      parseProviderPricingDocumentV1({
        schemaVersion: 1,
        billingMode: "fixed",
        fixedChargeAmount: "0.25",
        evidence: verifiedEvidence,
      }),
    ).toMatchObject({
      billingMode: "fixed",
      fixedChargeAmount: "0.25",
    });
    expect(() =>
      parseProviderPricingDocumentV1({
        schemaVersion: 1,
        billingMode: "fixed",
        fixedChargeAmount: "0.25",
      }),
    ).toThrow(/missing or unknown fields/u);
  });

  it("publishes provider-reported pricing only with exact charge-field evidence", () => {
    expect(
      parseProviderPricingDocumentV1({
        schemaVersion: 1,
        billingMode: "provider_reported",
        currencyCode: "USD",
        evidence: {
          chargeVerified: true,
          sourceKind: "provider_api",
          sourceReference: "generation.tasks.retrieve.data.charge",
          observedAt: "2026-08-12T12:00:00.000Z",
          sourceDigest: `sha256:${"b".repeat(64)}`,
        },
      }),
    ).toMatchObject({
      billingMode: "provider_reported",
      currencyCode: "USD",
    });
    expect(() =>
      parseProviderPricingDocumentV1({
        schemaVersion: 1,
        billingMode: "provider_reported",
        currencyCode: "USD",
        evidence: {
          chargeVerified: false,
          sourceKind: "provider_api",
          sourceReference: "generation.tasks.retrieve.data.charge",
          observedAt: "2026-08-12T12:00:00.000Z",
          sourceDigest: `sha256:${"b".repeat(64)}`,
        },
      }),
    ).toThrow(/evidence/u);
  });

  it("accepts only a bounded independent provider-reported money fact", () => {
    expect(
      parseProviderReportedCharge({
        source: "provider_reported",
        currencyCode: "USD",
        amount: "0.72",
      }),
    ).toEqual({
      source: "provider_reported",
      currencyCode: "USD",
      amount: "0.72",
    });
    expect(() =>
      parseProviderReportedCharge({
        source: "provider_reported",
        currencyCode: "usd",
        amount: "0.72",
      }),
    ).toThrow(/currency/u);
    expect(() =>
      parseProviderReportedCharge({
        source: "provider_reported",
        currencyCode: "USD",
        amount: "-0.01",
      }),
    ).toThrow(/DECIMAL/u);
    expect(() =>
      parseProviderReportedCharge({
        source: "provider_reported",
        currencyCode: "USD",
        amount: "0.1234567890123",
      }),
    ).toThrow(/DECIMAL/u);
    expect(() =>
      parseProviderReportedCharge({
        source: "provider_reported",
        currencyCode: "USD",
        amount: "0.72",
        quantity: "1",
      }),
    ).toThrow(/unknown fields/u);
  });
});
