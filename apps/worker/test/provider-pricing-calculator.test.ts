import { describe, expect, it } from "vitest";

import {
  calculateProviderCharge,
  resolveProviderCapturedAmount,
} from "../src/provider/provider-pricing-calculator.js";

const verifiedEvidence = Object.freeze({
  priceVerified: true,
  sourceKind: "provider_api",
  sourceReference: "provider.billing.response",
  observedAt: "2026-08-12T12:00:00.000Z",
  sourceDigest: `sha256:${"a".repeat(64)}`,
});

describe("Provider pricing calculator", () => {
  it("calculates fixed and metered prices with conservative 12-place rounding", () => {
    expect(
      calculateProviderCharge(
        {
          schemaVersion: 1,
          billingMode: "fixed",
          fixedChargeAmount: "0.25",
          evidence: verifiedEvidence,
        },
        [],
      ),
    ).toEqual({
      status: "calculated",
      amount: "0.25",
    });
    expect(
      calculateProviderCharge(
        {
          schemaVersion: 1,
          billingMode: "metered",
          rates: [
            {
              metricKey: "input_tokens",
              unitCode: "token",
              quantity: "1000000",
              amount: "2.5",
            },
            {
              metricKey: "output_tokens",
              unitCode: "token",
              quantity: "1000000",
              amount: "10",
            },
          ],
          evidence: verifiedEvidence,
        },
        [
          {
            metricKey: "input_tokens",
            numericValue: "1000",
            unitCode: "token",
          },
          {
            metricKey: "output_tokens",
            numericValue: "500",
            unitCode: "token",
          },
        ],
      ),
    ).toEqual({
      status: "calculated",
      amount: "0.0075",
    });
    expect(
      calculateProviderCharge(
        {
          schemaVersion: 1,
          billingMode: "metered",
          rates: [
            {
              metricKey: "input_tokens",
              unitCode: "token",
              quantity: "3",
              amount: "0.000000000001",
            },
          ],
          evidence: verifiedEvidence,
        },
        [
          {
            metricKey: "input_tokens",
            numericValue: "1",
            unitCode: "token",
          },
        ],
      ),
    ).toEqual({
      status: "calculated",
      amount: "0.000000000001",
    });
  });

  it("fails closed to unknown for old schemas or missing metered usage", () => {
    expect(
      calculateProviderCharge(
        {
          schemaVersion: 1,
          maximumChargeAmount: "10",
        },
        [],
      ),
    ).toEqual({
      status: "unknown",
      reason: "pricing_schema_unsupported",
    });
    expect(
      calculateProviderCharge(
        {
          schemaVersion: 1,
          billingMode: "metered",
          rates: [
            {
              metricKey: "output_tokens",
              unitCode: "token",
              quantity: "1000",
              amount: "1",
            },
          ],
          evidence: verifiedEvidence,
        },
        [],
      ),
    ).toEqual({
      status: "unknown",
      reason: "usage_missing",
    });
    expect(
      calculateProviderCharge(
        {
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
        },
        [
          {
            metricKey: "xai_cost_in_usd_ticks",
            numericValue: "72",
            unitCode: "usd_tick",
          },
        ],
      ),
    ).toEqual({
      status: "unknown",
      reason: "pricing_unverified",
    });
    expect(
      calculateProviderCharge(
        {
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
        },
        [],
      ),
    ).toEqual({
      status: "unknown",
      reason: "provider_charge_missing",
    });
    expect(
      calculateProviderCharge(
        {
          schemaVersion: 1,
          billingMode: "fixed",
          fixedChargeAmount: "0.72",
        },
        [],
      ),
    ).toEqual({
      status: "unknown",
      reason: "pricing_evidence_missing",
    });
  });

  it("rejects malformed recognized pricing instead of silently billing it", () => {
    expect(() =>
      calculateProviderCharge(
        {
          schemaVersion: 1,
          billingMode: "fixed",
          fixedChargeAmount: "0.25",
          evidence: verifiedEvidence,
          injected: true,
        },
        [],
      ),
    ).toThrow(/unknown fields/u);
  });

  it("uses one bounded capture rule for live execution and crash recovery", () => {
    expect(
      resolveProviderCapturedAmount({
        pricing: {
          schemaVersion: 1,
          billingMode: "fixed",
          fixedChargeAmount: "0.25",
          evidence: verifiedEvidence,
        },
        usage: [],
        currencyCode: "USD",
        maximumChargeAmount: "1",
      }),
    ).toBe("0.25");
    expect(
      resolveProviderCapturedAmount({
        pricing: {
          schemaVersion: 1,
          billingMode: "provider_reported",
          currencyCode: "USD",
          evidence: {
            chargeVerified: true,
            sourceKind: "provider_api",
            sourceReference: "provider.response.charge",
            observedAt: "2026-08-12T12:00:00.000Z",
            sourceDigest: `sha256:${"b".repeat(64)}`,
          },
        },
        usage: [],
        reportedCharge: {
          source: "provider_reported",
          currencyCode: "USD",
          amount: "1.25",
        },
        currencyCode: "USD",
        maximumChargeAmount: "1",
      }),
    ).toBeUndefined();
  });
});
