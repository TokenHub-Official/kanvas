import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  BudgetReservationStore,
  ResolvedAgentModelBinding,
} from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import {
  AgentModelBudgetError,
  createAgentModelBudgetPort,
} from "../src/agent/agent-model-budget.js";

const now = new Date("2026-08-24T20:00:00.000Z");
const authority = {
  workspaceId: "01K00000000000000000000001",
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000004",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["agent.run"],
  trusted: true,
} as const satisfies TrustedWorkspaceScope;

const verifiedEvidence = Object.freeze({
  priceVerified: true,
  sourceKind: "provider_api",
  sourceReference: "provider.billing.response",
  observedAt: "2026-08-24T19:00:00.000Z",
  sourceDigest: `sha256:${"a".repeat(64)}`,
});

function route(
  pricing: Readonly<Record<string, unknown>>,
): ResolvedAgentModelBinding {
  return {
    snapshot: {
      routeDigest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      pricingRevisionId: "01K00000000000000000000005",
    },
    endpoint: {
      id: "01K00000000000000000000006",
      adapterKind: "openai_compatible",
      presetKind: "none",
      baseUrl: "https://provider.example/v1",
    },
    apiSurface: "chat.completions.v1",
    protocolKind: "openai_chat",
    providerModelId: "model",
    modelProfile: {},
    pricing,
    budgetAccountId: "01K00000000000000000000007",
    maximumCharge: { currencyCode: "USD", amount: "1" },
    secret: {} as never,
    executionDeadlineAt: new Date(now.getTime() + 60_000),
  };
}

function harness() {
  const reserve = vi.fn<BudgetReservationStore["reserve"]>(() =>
    Promise.resolve({
      status: "reserved",
      reservationId: "01K00000000000000000000008",
      lifecycleStatus: "reserved",
      reservedAmount: "1",
      accountVersion: 2,
    }),
  );
  const finalize = vi.fn<BudgetReservationStore["finalize"]>((options) => {
    let lifecycleStatus: "released" | "settled" | "unknown" = "released";
    if (options.kind === "capture") lifecycleStatus = "settled";
    else if (options.kind === "unknown_hold") lifecycleStatus = "unknown";
    return Promise.resolve({
      status: "finalized",
      reservationId: options.reservationId,
      lifecycleStatus,
      settledAmount:
        options.kind === "capture" ? (options.capturedAmount ?? "0") : null,
      unknownHoldAmount: options.kind === "unknown_hold" ? "1" : null,
      accountVersion: 3,
    });
  });
  const budgets = {
    reserve,
    finalize,
    resolveUnknown: () => Promise.reject(new Error("unused")),
  } satisfies BudgetReservationStore;
  const port = createAgentModelBudgetPort({
    authority,
    budgets,
    identities: {
      reservationId: () => "01K00000000000000000000008",
      reserveLedgerEntryId: () => "01K00000000000000000000009",
      settleLedgerEntryId: () => "01K0000000000000000000000A",
      auditEventId: (_modelCallId, phase) =>
        phase === "reserve"
          ? "01K0000000000000000000000B"
          : "01K0000000000000000000000C",
    },
    digest: () =>
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  return { port, reserve, finalize };
}

describe("createAgentModelBudgetPort", () => {
  it("reserves against AgentModelCall and captures measured token pricing", async () => {
    const value = harness();
    const binding = route({
      schemaVersion: 1,
      billingMode: "metered",
      rates: [
        {
          metricKey: "input_tokens_no_cache",
          unitCode: "token",
          quantity: "1000",
          amount: "0.1",
        },
        {
          metricKey: "cache_read_tokens",
          unitCode: "token",
          quantity: "1000",
          amount: "0.01",
        },
        {
          metricKey: "output_tokens",
          unitCode: "token",
          quantity: "1000",
          amount: "0.2",
        },
      ],
      evidence: verifiedEvidence,
    });
    const reservation = await value.port.reserve({
      route: binding,
      request: {
        schemaVersion: "kanvas.agent-model-request/v1",
        controls: { reasoningLevel: "medium", webSearchMode: "off" },
        prompt: [],
        tools: [],
      },
      agentRunId: "01K0000000000000000000000D",
      modelCallId: "01K0000000000000000000000E",
      now,
    });
    await value.port.capture({
      reservation,
      route: binding,
      response: {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
        usage: {
          inputTokens: 100,
          inputTokensNoCache: 70,
          cacheReadTokens: 30,
          outputTokens: 50,
        },
      },
      modelCallId: "01K0000000000000000000000E",
      now,
    });

    expect(value.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        consumerKind: "agent_model_call",
        agentRunId: "01K0000000000000000000000D",
        agentModelCallId: "01K0000000000000000000000E",
        maximumChargeAmount: "1",
      }),
    );
    expect(value.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "capture", capturedAmount: "0.0173" }),
    );
  });

  it("holds the maximum charge when pricing cannot measure the response", async () => {
    const value = harness();
    const binding = route({
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
    const reservation = await value.port.reserve({
      route: binding,
      request: {
        schemaVersion: "kanvas.agent-model-request/v1",
        controls: { reasoningLevel: "medium", webSearchMode: "off" },
        prompt: [],
        tools: [],
      },
      agentRunId: "01K0000000000000000000000D",
      modelCallId: "01K0000000000000000000000E",
      now,
    });
    await expect(
      value.port.capture({
        reservation,
        route: binding,
        response: { content: [], finishReason: "stop" },
        modelCallId: "01K0000000000000000000000E",
        now,
      }),
    ).rejects.toEqual(new AgentModelBudgetError("agent.model_charge_unknown"));
    expect(value.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "unknown_hold" }),
    );
  });

  it("prefers an exact Provider-reported charge over calculated token pricing", async () => {
    const value = harness();
    const binding = route({
      schemaVersion: 1,
      billingMode: "metered",
      rates: [
        {
          metricKey: "input_tokens",
          unitCode: "token",
          quantity: "1000",
          amount: "0.1",
        },
      ],
      evidence: verifiedEvidence,
    });
    const reservation = await value.port.reserve({
      route: binding,
      request: {
        schemaVersion: "kanvas.agent-model-request/v1",
        controls: { reasoningLevel: "medium", webSearchMode: "off" },
        prompt: [],
        tools: [],
      },
      agentRunId: "01K0000000000000000000000D",
      modelCallId: "01K0000000000000000000000E",
      now,
    });
    await value.port.capture({
      reservation,
      route: binding,
      response: {
        content: [],
        finishReason: "stop",
        reportedCharge: { currencyCode: "USD", amount: "0.0042" },
      },
      modelCallId: "01K0000000000000000000000E",
      now,
    });

    expect(value.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "capture", capturedAmount: "0.0042" }),
    );
  });
});
