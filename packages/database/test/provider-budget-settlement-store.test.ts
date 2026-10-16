import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createProviderBudgetSettlementStore } from "../src/runtime/provider-budget-settlement-store.js";

import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function row(
  overrides: Readonly<Record<string, string | number>> = {},
): Readonly<Record<string, string | number>> {
  return {
    workspaceId: id(1),
    invocationId: id(2),
    invocationAttemptId: id(3),
    invocationPricingRevisionId: id(4),
    invocationBudgetReservationId: id(5),
    remoteStatus: "succeeded",
    sideEffectState: "committed",
    reservationLifecycle: "reserved",
    reservationVersion: 1,
    budgetAccountId: id(6),
    reservationId: id(5),
    reservationAttemptId: id(3),
    reservationPricingRevisionId: id(4),
    requestDigest: digest("a"),
    ...overrides,
  };
}

describe("ProviderBudgetSettlementStore", () => {
  it("maps bounded terminal reservations without exposing pricing or secret documents", async () => {
    const execute = vi.fn((sql: string, parameters: readonly unknown[]) => {
      void sql;
      void parameters;
      return Promise.resolve([[row()], []]);
    });
    const store = createProviderBudgetSettlementStore({
      execute,
    } as unknown as Pool);

    await expect(store.scanPending({ batchSize: 20 })).resolves.toEqual([
      {
        workspaceId: id(1),
        invocationId: id(2),
        budgetAccountId: id(6),
        reservationId: id(5),
        requestDigest: digest("a"),
        remoteStatus: "succeeded",
        sideEffectState: "committed",
        reservationLifecycle: "reserved",
        reservationVersion: 1,
      },
    ]);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toContain("LIMIT 20");
    expect(execute.mock.calls[0]?.[0]).toContain(
      "invocation.work_state = 'manual'",
    );
    expect(execute.mock.calls[0]?.[0]).toContain(
      "reservation.expires_at <= CURRENT_TIMESTAMP(3)",
    );
    expect(execute.mock.calls[0]?.[0]).toContain(
      "reservation.lifecycle_status = 'unknown'",
    );
    expect(execute.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("rescans an unknown hold when persisted facts prove no external effect", async () => {
    const store = createProviderBudgetSettlementStore({
      execute: () =>
        Promise.resolve([
          [
            row({
              remoteStatus: "cancelled",
              sideEffectState: "not_started",
              reservationLifecycle: "unknown",
              reservationVersion: 3,
            }),
          ],
          [],
        ]),
    } as unknown as Pool);

    await expect(store.scanPending({ batchSize: 1 })).resolves.toEqual([
      {
        workspaceId: id(1),
        invocationId: id(2),
        budgetAccountId: id(6),
        reservationId: id(5),
        requestDigest: digest("a"),
        remoteStatus: "cancelled",
        reservationLifecycle: "unknown",
        reservationVersion: 3,
        sideEffectState: "not_started",
      },
    ]);
  });

  it("maps an expired manual invocation to an unknown-hold candidate", async () => {
    const store = createProviderBudgetSettlementStore({
      execute: () =>
        Promise.resolve([
          [
            row({
              remoteStatus: "unknown",
              sideEffectState: "unknown",
            }),
          ],
          [],
        ]),
    } as unknown as Pool);

    await expect(store.scanPending({ batchSize: 1 })).resolves.toEqual([
      {
        workspaceId: id(1),
        invocationId: id(2),
        budgetAccountId: id(6),
        reservationId: id(5),
        requestDigest: digest("a"),
        remoteStatus: "unknown",
        sideEffectState: "unknown",
        reservationLifecycle: "reserved",
        reservationVersion: 1,
      },
    ]);
  });

  it("loads persisted pricing, canonical Usage and provider-reported charge evidence", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            pricingDocument: {
              schemaVersion: 1,
              billingMode: "metered",
              rates: [],
            },
            currencyCode: "USD",
            maximumChargeAmount: "2.000000000000",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            metricKey: "input_tokens",
            valueDimension: "quantity",
            unitCode: "token",
            numericValue: "12.000000000000",
            currencyCode: null,
          },
          {
            metricKey: "provider_reported_charge",
            valueDimension: "money",
            unitCode: null,
            numericValue: "0.720000000000",
            currencyCode: "USD",
          },
        ],
        [],
      ]);
    const store = createProviderBudgetSettlementStore({
      execute,
    } as unknown as Pool);

    await expect(
      store.loadEvidence({
        workspaceId: id(1),
        invocationId: id(2),
        budgetAccountId: id(6),
        reservationId: id(5),
        requestDigest: digest("a"),
        remoteStatus: "succeeded",
        sideEffectState: "committed",
        reservationLifecycle: "reserved",
        reservationVersion: 1,
      }),
    ).resolves.toEqual({
      pricingDocument: {
        schemaVersion: 1,
        billingMode: "metered",
        rates: [],
      },
      currencyCode: "USD",
      maximumChargeAmount: "2",
      usage: [
        {
          metricKey: "input_tokens",
          numericValue: "12",
          unitCode: "token",
        },
      ],
      reportedCharge: { currencyCode: "USD", amount: "0.72" },
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("retains provider charge evidence before output Usage exists", async () => {
    const facts = {
      schemaVersion: 1,
      usage: [],
      reportedCharge: {
        source: "provider_reported",
        currencyCode: "USD",
        amount: "0.72",
      },
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            pricingDocument: {},
            currencyCode: "USD",
            maximumChargeAmount: "1",
            resultFacts: [{ facts, digest: digestProviderValue(facts) }],
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([[], []]);
    const store = createProviderBudgetSettlementStore({
      execute,
    } as unknown as Pool);
    const [candidate] = await createProviderBudgetSettlementStore({
      execute: () => Promise.resolve([[row()], []]),
    } as unknown as Pool).scanPending({ batchSize: 1 });
    if (!candidate) throw new Error("Missing candidate");
    await expect(store.loadEvidence(candidate)).resolves.toMatchObject({
      usage: [],
      reportedCharge: { currencyCode: "USD", amount: "0.72" },
    });
  });

  it("maps terminal Agent attempts whose reserved budgets need recovery", async () => {
    let observedSql = "";
    const execute = vi.fn((sql: string) => {
      observedSql = sql;
      return Promise.resolve([
        [
          {
            workspaceId: id(1),
            modelCallId: id(8),
            budgetAccountId: id(6),
            reservationId: id(9),
            requestDigest: digest("b"),
            attemptStatus: "succeeded",
            pricingDocument: {
              schemaVersion: 1,
              billingMode: "fixed",
              fixedChargeAmount: "0.25",
            },
            currencyCode: "USD",
            maximumChargeAmount: "1.000000000000",
            usageDocument: {
              schemaVersion: 1,
              inputTokens: 12,
            },
          },
        ],
        [],
      ]);
    });
    const store = createProviderBudgetSettlementStore({
      execute,
    } as unknown as Pool);

    await expect(store.scanAgentPending({ batchSize: 20 })).resolves.toEqual([
      {
        workspaceId: id(1),
        modelCallId: id(8),
        budgetAccountId: id(6),
        reservationId: id(9),
        requestDigest: digest("b"),
        attemptStatus: "succeeded",
        pricingDocument: {
          schemaVersion: 1,
          billingMode: "fixed",
          fixedChargeAmount: "0.25",
        },
        currencyCode: "USD",
        maximumChargeAmount: "1",
        usageDocument: { schemaVersion: 1, inputTokens: 12 },
      },
    ]);
    expect(observedSql).toContain("reservation.lifecycle_status = 'reserved'");
    expect(observedSql).toContain("LIMIT 20");
  });

  it("fails closed when terminal invocation and reservation pins disagree", async () => {
    const store = createProviderBudgetSettlementStore({
      execute: () =>
        Promise.resolve([
          [
            row({
              reservationPricingRevisionId: id(7),
            }),
          ],
          [],
        ]),
    } as unknown as Pool);

    await expect(store.scanPending({ batchSize: 1 })).rejects.toThrow(
      "Provider terminal invocation has inconsistent budget settlement pins.",
    );
  });

  it("rejects unbounded scans before querying MySQL", async () => {
    const execute = vi.fn();
    const store = createProviderBudgetSettlementStore({
      execute,
    } as unknown as Pool);

    await expect(store.scanPending({ batchSize: 101 })).rejects.toThrow(
      "Provider budget settlement batchSize must be between 1 and 100.",
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
