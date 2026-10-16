import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  getWorkspaceUsageSummaryRoute,
  resolveUnknownBudgetHoldRoute,
  ResolveUnknownBudgetHoldBodySchema,
  routeRegistry,
  updateWorkspaceBudgetRoute,
  UpdateWorkspaceBudgetBodySchema,
  WorkspaceUsageSummarySchema,
} from "../src/api/index.js";

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
  });
  const registerFormats = addFormats as unknown as (
    instance: Ajv2020,
  ) => unknown;
  registerFormats(ajv);
  return ajv;
}

describe("Workspace Usage Summary contract", () => {
  it("registers one read-only authorized summary route", () => {
    expect(getWorkspaceUsageSummaryRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/usage-summary",
      security: ["sessionOrServiceToken"],
      idempotency: "none",
    });
    expect(routeRegistry).toContain(getWorkspaceUsageSummaryRoute);
  });

  it("registers a bounded unknown-hold resolution command", () => {
    expect(resolveUnknownBudgetHoldRoute).toMatchObject({
      method: "POST",
      path: "/api/v1/usage-summary/unknown-holds/{budgetReservationId}/resolution",
      security: ["sessionOrServiceToken"],
      idempotency: "optional",
    });
    expect(routeRegistry).toContain(resolveUnknownBudgetHoldRoute);
    const validate = createAjv().compile(ResolveUnknownBudgetHoldBodySchema);
    expect(
      validate({
        expectedVersion: 2,
        resolution: "charged",
        chargedAmount: "0.72",
        evidenceReference: "TokenHub task history 2026-08-06",
      }),
    ).toBe(true);
    expect(
      validate({
        expectedVersion: 2,
        resolution: "not_charged",
        evidenceReference: "  ",
      }),
    ).toBe(false);
  });

  it("registers a versioned Provider budget limit command", () => {
    expect(updateWorkspaceBudgetRoute).toMatchObject({
      method: "PATCH",
      path: "/api/v1/usage-summary/budgets/{providerSettingId}",
      security: ["sessionOrServiceToken"],
      idempotency: "none",
    });
    expect(routeRegistry).toContain(updateWorkspaceBudgetRoute);
    const validate = createAjv().compile(UpdateWorkspaceBudgetBodySchema);
    expect(
      validate({
        expectedVersion: 2,
        hardLimitAmount: "80.00",
      }),
    ).toBe(true);
    expect(
      validate({
        expectedVersion: 2,
        hardLimitAmount: "-1",
      }),
    ).toBe(false);
  });

  it("accepts bounded budget and metric facts without account keys", () => {
    const validate = createAjv().compile(WorkspaceUsageSummarySchema);
    expect(
      validate({
        generatedAt: "2026-08-05T00:00:00.000Z",
        windowStartAt: "2026-07-06T00:00:00.000Z",
        windowEndAt: "2026-08-05T00:00:00.000Z",
        trackedAttemptCount: 12,
        unknownUsageCount: 1,
        budgets: [
          {
            name: "团队 TokenHub",
            providerSettingId: "01K00000000000000000000001",
            status: "active",
            currencyCode: "USD",
            periodStartAt: "2026-08-01T00:00:00.000Z",
            periodEndAt: "2026-09-01T00:00:00.000Z",
            hardLimitAmount: "100.000000000000",
            consumedAmount: "12.500000000000",
            reservedAmount: "1.000000000000",
            unknownHeldAmount: "0.720000000000",
            remainingAmount: "85.780000000000",
            version: 1,
          },
        ],
        unknownHolds: [
          {
            id: "01K00000000000000000000002",
            providerName: "团队 TokenHub",
            workflowRunId: "01K00000000000000000000003",
            currencyCode: "USD",
            heldAmount: "0.720000000000",
            version: 2,
            submittedAt: "2026-08-04T09:59:00.000Z",
            heldAt: "2026-08-04T10:00:00.000Z",
          },
        ],
        metrics: [
          {
            metricKey: "compute.wall_time",
            dimension: "quantity",
            unitCode: "millisecond",
            value: "4520.000000000000",
            unknownCount: 0,
            lastRecordedAt: "2026-08-04T10:00:00.000Z",
          },
        ],
      }),
    ).toBe(true);
    expect(
      validate({
        generatedAt: "2026-08-05T00:00:00.000Z",
        windowStartAt: "2026-07-06T00:00:00.000Z",
        windowEndAt: "2026-08-05T00:00:00.000Z",
        trackedAttemptCount: 0,
        unknownUsageCount: 0,
        budgets: [
          {
            name: "团队额度",
            accountKey: "internal-budget-key",
          },
        ],
        unknownHolds: [],
        metrics: [],
      }),
    ).toBe(false);
  });
});
