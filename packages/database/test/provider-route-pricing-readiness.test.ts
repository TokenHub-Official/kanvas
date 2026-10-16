import { describe, expect, it } from "vitest";

import {
  providerRouteModelProfileSchemaSupported,
  validateProviderPricingForRoute,
} from "../src/runtime/provider-route-store.js";
import type { ProviderRouteStoreError } from "../src/runtime/provider-route-store.js";

const evidence = {
  priceVerified: true,
  sourceKind: "contract",
  sourceReference: "contract://test/provider/model",
  observedAt: "2026-08-12T07:00:00.000Z",
  sourceDigest: `sha256:${"a".repeat(64)}`,
};

describe("Provider route pricing readiness", () => {
  it("accepts the current canonical Model Profile schema", () => {
    expect(providerRouteModelProfileSchemaSupported(1)).toBe(true);
    expect(providerRouteModelProfileSchemaSupported(2)).toBe(false);
    expect(providerRouteModelProfileSchemaSupported(3)).toBe(false);
    expect(providerRouteModelProfileSchemaSupported(4)).toBe(false);
  });

  it("rejects unverified pricing before dispatch", () => {
    expect(() =>
      validateProviderPricingForRoute({
        pricingDocument: {
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
        pricingCurrencyCode: "USD",
        maximumChargeAmount: "1",
      }),
    ).toThrow(
      expect.objectContaining<Partial<ProviderRouteStoreError>>({
        code: "provider_route.unavailable",
      }),
    );
  });

  it("admits verified fixed pricing only within the route ceiling", () => {
    expect(() =>
      validateProviderPricingForRoute({
        pricingDocument: {
          schemaVersion: 1,
          billingMode: "fixed",
          fixedChargeAmount: "0.25",
          evidence,
        },
        pricingCurrencyCode: "USD",
        maximumChargeAmount: "1",
      }),
    ).not.toThrow();
    expect(() =>
      validateProviderPricingForRoute({
        pricingDocument: {
          schemaVersion: 1,
          billingMode: "fixed",
          fixedChargeAmount: "2",
          evidence,
        },
        pricingCurrencyCode: "USD",
        maximumChargeAmount: "1",
      }),
    ).toThrow(/exceeds/u);
  });

  it("admits only the exact TokenHub Generation Tasks charge contract", () => {
    expect(() =>
      validateProviderPricingForRoute({
        pricingDocument: {
          schemaVersion: 1,
          billingMode: "provider_reported",
          currencyCode: "USD",
          evidence: {
            chargeVerified: true,
            sourceKind: "contract",
            sourceReference: "tokenhub.generation-task.quota",
            observedAt: "2026-08-31T00:00:00.000Z",
            sourceDigest: `sha256:${"b".repeat(64)}`,
          },
        },
        pricingCurrencyCode: "USD",
        maximumChargeAmount: "1",
        providerPreset: "tokenhub",
        apiSurface: "generation.tasks.v1",
      }),
    ).not.toThrow();
    expect(() =>
      validateProviderPricingForRoute({
        pricingDocument: {
          schemaVersion: 1,
          billingMode: "provider_reported",
          currencyCode: "USD",
          evidence: {
            chargeVerified: true,
            sourceKind: "contract",
            sourceReference: "tokenhub.generation-task.quota",
            observedAt: "2026-08-31T00:00:00.000Z",
            sourceDigest: `sha256:${"b".repeat(64)}`,
          },
        },
        pricingCurrencyCode: "USD",
        maximumChargeAmount: "1",
        providerPreset: "tokenhub",
        apiSurface: "chat.completions.v1",
      }),
    ).toThrow(
      expect.objectContaining<Partial<ProviderRouteStoreError>>({
        code: "provider_route.unavailable",
      }),
    );
  });
});
