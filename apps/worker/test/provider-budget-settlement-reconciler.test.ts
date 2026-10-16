import type {
  ApplicationRuntime,
  RuntimeStateReader,
} from "@kanvas/application";
import type {
  BudgetReservationStore,
  FinalizeBudgetReservationOptions,
  ProviderBudgetSettlementStore,
} from "@kanvas/database/runtime";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { ProviderBudgetSettlementReconciler } from "../src/reconciler/provider-budget-settlement-reconciler.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

describe("ProviderBudgetSettlementReconciler", () => {
  it("holds uncertain terminal work and releases facts that prove no external effect", async () => {
    const settlements: ProviderBudgetSettlementStore = {
      scanAgentPending: () =>
        Promise.resolve([
          {
            workspaceId: id(1),
            modelCallId: id(20),
            budgetAccountId: id(3),
            reservationId: id(21),
            requestDigest: digest("f"),
            attemptStatus: "succeeded",
            pricingDocument: {
              schemaVersion: 1,
              billingMode: "fixed",
              fixedChargeAmount: "0.25",
              evidence: {
                priceVerified: true,
                sourceKind: "contract",
                sourceReference: "contract://test/agent-model",
                observedAt: "2026-07-28T11:00:00.000Z",
                sourceDigest: digest("a"),
              },
            },
            currencyCode: "USD",
            maximumChargeAmount: "1",
            usageDocument: { schemaVersion: 1, inputTokens: 10 },
          },
          {
            workspaceId: id(1),
            modelCallId: id(22),
            budgetAccountId: id(3),
            reservationId: id(23),
            requestDigest: digest("h"),
            attemptStatus: "failed",
            pricingDocument: {
              schemaVersion: 1,
              billingMode: "fixed",
              fixedChargeAmount: "0.25",
              evidence: {
                priceVerified: true,
                sourceKind: "contract",
                sourceReference: "contract://test/agent-model",
                observedAt: "2026-07-28T11:00:00.000Z",
                sourceDigest: digest("b"),
              },
            },
            currencyCode: "USD",
            maximumChargeAmount: "1",
          },
          {
            workspaceId: id(1),
            modelCallId: id(24),
            budgetAccountId: id(3),
            reservationId: id(25),
            requestDigest: digest("j"),
            attemptStatus: "unknown",
            pricingDocument: {
              schemaVersion: 1,
              billingMode: "fixed",
              fixedChargeAmount: "0.25",
              evidence: {
                priceVerified: true,
                sourceKind: "contract",
                sourceReference: "contract://test/agent-model",
                observedAt: "2026-07-28T11:00:00.000Z",
                sourceDigest: digest("c"),
              },
            },
            currencyCode: "USD",
            maximumChargeAmount: "1",
          },
        ]),
      scanPending: () =>
        Promise.resolve([
          {
            workspaceId: id(1),
            invocationId: id(2),
            budgetAccountId: id(3),
            reservationId: id(4),
            requestDigest: digest("a"),
            remoteStatus: "succeeded",
            sideEffectState: "committed",
            reservationLifecycle: "reserved",
            reservationVersion: 1,
          },
          {
            workspaceId: id(1),
            invocationId: id(5),
            budgetAccountId: id(3),
            reservationId: id(6),
            requestDigest: digest("b"),
            remoteStatus: "not_found",
            sideEffectState: "not_started",
            reservationLifecycle: "reserved",
            reservationVersion: 1,
          },
          {
            workspaceId: id(1),
            invocationId: id(7),
            budgetAccountId: id(3),
            reservationId: id(8),
            requestDigest: digest("c"),
            remoteStatus: "cancelled",
            sideEffectState: "not_started",
            reservationLifecycle: "reserved",
            reservationVersion: 1,
          },
          {
            workspaceId: id(1),
            invocationId: id(9),
            budgetAccountId: id(3),
            reservationId: id(10),
            requestDigest: digest("d"),
            remoteStatus: "cancelled",
            sideEffectState: "not_started",
            reservationLifecycle: "unknown",
            reservationVersion: 3,
          },
          {
            workspaceId: id(1),
            invocationId: id(30),
            budgetAccountId: id(3),
            reservationId: id(31),
            requestDigest: digest("e"),
            remoteStatus: "succeeded",
            sideEffectState: "committed",
            reservationLifecycle: "unknown",
            reservationVersion: 3,
          },
        ]),
      loadEvidence: () =>
        Promise.resolve({
          pricingDocument: {
            schemaVersion: 1,
            billingMode: "fixed",
            fixedChargeAmount: "0.5",
            evidence: {
              priceVerified: true,
              sourceKind: "contract",
              sourceReference: "contract://test/provider/model",
              observedAt: "2026-07-28T11:00:00.000Z",
              sourceDigest: digest("e"),
            },
          },
          currencyCode: "USD",
          maximumChargeAmount: "1",
          usage: [],
        }),
    };
    const finalize = vi.fn((options: FinalizeBudgetReservationOptions) =>
      Promise.resolve({
        status: "finalized" as const,
        reservationId: options.reservationId,
        lifecycleStatus:
          options.kind === "release"
            ? ("released" as const)
            : ("unknown" as const),
        settledAmount: null,
        unknownHoldAmount: options.kind === "unknown_hold" ? "1" : null,
        accountVersion: 2,
      }),
    );
    const resolveUnknown = vi.fn(() =>
      Promise.resolve({
        status: "resolved" as const,
        reservationId: id(10),
        lifecycleStatus: "released" as const,
        chargedAmount: "0",
        resolvedAt: new Date("2026-07-28T12:00:00.000Z"),
        accountVersion: 3,
      }),
    );
    const budgets: BudgetReservationStore = {
      reserve: vi.fn(),
      finalize,
      resolveUnknown,
    };
    const runtimeStateReader: RuntimeStateReader = {
      read: () =>
        Promise.resolve({
          state: "ACTIVE",
          executionGeneration: 7,
          stateVersion: 1,
        }),
    };
    const runtime = {
      runtimeFence: {
        assertAllowed: vi.fn(() =>
          Promise.resolve({
            state: "ACTIVE" as const,
            executionGeneration: 7,
            stateVersion: 1,
          }),
        ),
      },
    } as unknown as ApplicationRuntime;
    const logger = {
      error: vi.fn(),
    } as unknown as Pick<Logger, "error">;
    let nextIdValue = 100;
    const reconciler = new ProviderBudgetSettlementReconciler({
      runtime,
      runtimeStateReader,
      settlements,
      budgets,
      logger,
      nextId: () => id(nextIdValue++),
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });

    await expect(reconciler.runOnce()).resolves.toEqual({
      scanned: 8,
      finalized: 8,
      replayed: 0,
      failed: 0,
    });
    expect(finalize).toHaveBeenCalledTimes(6);
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({
      kind: "capture",
      capturedAmount: "0.5",
      ledgerEntryKey: `provider-terminal:${id(2)}`,
    });
    expect(finalize.mock.calls[1]?.[0]).toMatchObject({
      kind: "release",
      ledgerEntryKey: `provider-terminal:${id(5)}`,
    });
    expect(finalize.mock.calls[2]?.[0]).toMatchObject({
      kind: "release",
      ledgerEntryKey: `provider-terminal:${id(7)}`,
    });
    expect(resolveUnknown).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: id(1),
        reservationId: id(10),
        expectedVersion: 3,
        resolution: "not_charged",
        evidenceReference: "provider.side_effect.not_started",
      }),
    );
    expect(finalize.mock.calls[3]?.[0]).toMatchObject({
      kind: "capture",
      capturedAmount: "0.25",
      ledgerEntryKey: `agent-model-terminal:${id(20)}`,
    });
    expect(finalize.mock.calls[4]?.[0]).toMatchObject({
      kind: "release",
      ledgerEntryKey: `agent-model-terminal:${id(22)}`,
    });
    expect(finalize.mock.calls[5]?.[0]).toMatchObject({
      kind: "unknown_hold",
      ledgerEntryKey: `agent-model-terminal:${id(24)}`,
    });
    expect(resolveUnknown).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: id(31),
        resolution: "charged",
        chargedAmount: "0.5",
        evidenceReference: `provider.confirmed_result:${id(30)}`,
      }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
