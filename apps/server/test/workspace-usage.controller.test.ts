import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  ResolveUnknownBudgetHoldOptions,
  UpdateWorkspaceBudgetLimitOptions,
} from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
import { WorkspaceUsageController } from "../src/http/workspace-usage.controller.js";

const workspaceId = "01K00000000000000000000001";
const scope: TrustedWorkspaceScope = {
  workspaceId,
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "01K00000000000000000000004",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000005",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["usage.read"],
  trusted: true,
};
const serviceScope: TrustedWorkspaceScope = {
  ...scope,
  principalType: "service",
  authenticationRefType: "service_api_token",
  authorityType: "service_grant",
};

function authorizedContexts(
  request: FastifyRequest,
  authorizedScope: TrustedWorkspaceScope = scope,
): RequestAuthorizationContextStore {
  const contexts = new RequestAuthorizationContextStore();
  contexts.set(request, {
    authentication: {
      authSubjectId: "usage-reader",
      sessionId: authorizedScope.authenticationRefId,
      authenticationStrength: "single_factor",
    },
    scope: authorizedScope,
  });
  return contexts;
}

describe("WorkspaceUsageController", () => {
  it("returns a 30-day redacted usage projection", async () => {
    const request = {
      id: "request-usage-summary",
    } as FastifyRequest;
    const get = vi.fn().mockResolvedValue({
      trackedAttemptCount: 3,
      unknownUsageCount: 1,
      budgets: [
        {
          name: "团队模型服务",
          providerSettingId: "01K00000000000000000000006",
          status: "active",
          currencyCode: "USD",
          periodStartAt: new Date("2026-08-01T00:00:00.000Z"),
          periodEndAt: new Date("2026-09-01T00:00:00.000Z"),
          hardLimitAmount: "100.000000000000",
          consumedAmount: "10.000000000000",
          reservedAmount: "2.000000000000",
          unknownHeldAmount: "0.720000000000",
          remainingAmount: "87.280000000000",
          version: 1,
        },
      ],
      unknownHolds: [
        {
          id: "01K00000000000000000000007",
          capabilityRunId: "01K00000000000000000000008",
          providerName: "团队模型服务",
          workflowRunId: "01K00000000000000000000008",
          currencyCode: "USD",
          heldAmount: "0.720000000000",
          version: 2,
          submittedAt: new Date("2026-08-04T00:00:00.000Z"),
          heldAt: new Date("2026-08-04T00:01:00.000Z"),
        },
      ],
      metrics: [
        {
          metricKey: "compute.wall_time",
          dimension: "quantity",
          unitCode: "millisecond",
          value: "1200.000000000000",
          unknownCount: 0,
          lastRecordedAt: new Date("2026-08-04T00:00:00.000Z"),
        },
      ],
    });
    const controller = new WorkspaceUsageController(
      {
        workspaceUsageSummary: {
          get,
          updateBudgetLimit: () =>
            Promise.reject(
              new Error(
                "Workspace budget updates are not expected in this test.",
              ),
            ),
        },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(request),
    );

    const result = await controller.get(request);

    expect(get).toHaveBeenCalledWith(scope, expect.any(Date), expect.any(Date));
    const [, windowStartAt, windowEndAt] = get.mock.calls[0] as [
      TrustedWorkspaceScope,
      Date,
      Date,
    ];
    expect(windowEndAt.getTime() - windowStartAt.getTime()).toBe(
      30 * 24 * 60 * 60 * 1000,
    );
    expect(result).toMatchObject({
      trackedAttemptCount: 3,
      unknownUsageCount: 1,
      budgets: [
        {
          name: "团队模型服务",
          periodStartAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      unknownHolds: [
        {
          id: "01K00000000000000000000007",
          capabilityRunId: "01K00000000000000000000008",
          heldAt: "2026-08-04T00:01:00.000Z",
        },
      ],
      metrics: [
        {
          metricKey: "compute.wall_time",
          lastRecordedAt: "2026-08-04T00:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("budget_account");
  });

  it("resolves one externally verified unknown hold", async () => {
    const request = {
      id: "request-resolve-unknown",
    } as FastifyRequest;
    const resolveUnknown = vi.fn().mockResolvedValue({
      status: "resolved",
      reservationId: "01K00000000000000000000007",
      lifecycleStatus: "settled",
      chargedAmount: "0.72",
      resolvedAt: new Date("2026-08-05T00:00:00.000Z"),
      accountVersion: 4,
    });
    const controller = new WorkspaceUsageController(
      {
        budgetReservations: { resolveUnknown },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(request, serviceScope),
    );

    const result = await controller.resolveUnknownHold(
      request,
      {
        budgetReservationId: "01K00000000000000000000007",
      },
      {
        expectedVersion: 2,
        resolution: "charged",
        chargedAmount: "0.72",
        evidenceReference: "TokenHub task history 2026-08-05",
      },
    );

    expect(result).toMatchObject({
      result: "resolved",
      lifecycleStatus: "settled",
      chargedAmount: "0.72",
    });
    const [options] = resolveUnknown.mock.calls[0] as [
      ResolveUnknownBudgetHoldOptions,
    ];
    expect(options).toMatchObject({
      scope: serviceScope,
      expectedVersion: 2,
      resolution: "charged",
      chargedAmount: "0.72",
    });
    expect(options.requestDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("lets an authorized Workspace administrator resolve an unknown cost", async () => {
    const request = { id: "request-human-resolution" } as FastifyRequest;
    const resolveUnknown = vi.fn().mockResolvedValue({
      status: "resolved",
      reservationId: "01K00000000000000000000007",
      lifecycleStatus: "released",
      chargedAmount: "0",
      resolvedAt: new Date("2026-08-05T00:00:00.000Z"),
      accountVersion: 4,
    });
    const controller = new WorkspaceUsageController(
      {
        budgetReservations: { resolveUnknown },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(request),
    );

    const result = await controller.resolveUnknownHold(
      request,
      { budgetReservationId: "01K00000000000000000000007" },
      {
        expectedVersion: 2,
        resolution: "not_charged",
        evidenceReference: "Provider request history shows no charge",
      },
    );

    expect(result.lifecycleStatus).toBe("released");
    expect(resolveUnknown).toHaveBeenCalledWith(
      expect.objectContaining({
        scope,
        resolution: "not_charged",
      }),
    );
  });

  it("updates one Provider budget limit with optimistic concurrency", async () => {
    const request = {
      id: "request-update-budget",
    } as FastifyRequest;
    const updateBudgetLimit = vi.fn().mockResolvedValue({
      providerSettingId: "01K00000000000000000000006",
      hardLimitAmount: "80.00",
      version: 3,
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    const controller = new WorkspaceUsageController(
      {
        workspaceUsageSummary: {
          updateBudgetLimit,
        },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(request),
    );

    const result = await controller.updateBudget(
      request,
      {
        providerSettingId: "01K00000000000000000000006",
      },
      {
        expectedVersion: 2,
        hardLimitAmount: "80.00",
      },
    );

    expect(result).toMatchObject({
      providerSettingId: "01K00000000000000000000006",
      hardLimitAmount: "80.00",
      version: 3,
    });
    const [options] = updateBudgetLimit.mock.calls[0] as [
      UpdateWorkspaceBudgetLimitOptions,
    ];
    expect(options).toMatchObject({
      scope,
      providerSettingId: "01K00000000000000000000006",
      expectedVersion: 2,
      hardLimitAmount: "80.00",
    });
  });
});
