import type {
  ApplicationRuntime,
  CurrentProviderRouteSnapshot,
} from "@kanvas/application";
import { digestProviderValue } from "@kanvas/database/runtime";
import type {
  BudgetReservationStore,
  AppendProviderObservationOptions,
  ProviderExecutionContextStore,
  ProviderInvocationClaim,
  ProviderInvocationExecutionContext,
  ProviderInvocationStore,
  FinalizeBudgetReservationOptions,
  ReserveBudgetOptions,
  ResolveProviderInvocationExecutionContextOptions,
} from "@kanvas/database/runtime";
import { createIdentityCapabilityMappingPlanV1 } from "@kanvas/contracts/capability";
import { describe, expect, it, vi } from "vitest";

import {
  createProviderAdapterRegistry,
  type AsyncProviderAdapter,
  type AuthorizedProviderInvocationRequest,
  ProviderAdapterCallError,
} from "../src/provider/provider-adapter.js";
import { ProviderInvocationRunner } from "../src/provider/provider-invocation-runner.js";
import type { ProviderSecretMaterialResolver } from "../src/provider/provider-secret-resolver.js";

const NOW = new Date("2026-07-28T12:00:00.000Z");
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const route = Object.freeze<CurrentProviderRouteSnapshot>({
  providerProtocolVersion: 1,
  providerKey: "test",
  apiSurface: "responses.v1",
  providerEndpointId: id(1),
  credentialIdentityId: id(2),
  credentialIdentityEpoch: 1,
  pinnedSecretVersionId: id(3),
  credentialIdentityDigest: digest("a"),
  instancePolicyRevisionId: id(4),
  workspacePolicyRevisionId: id(5),
  routePolicyRevisionId: id(6),
  modelProfileRevisionId: id(7),
  modelDeploymentId: id(8),
  pricingRevisionId: id(9),
  budgetAccountId: id(10),
  routingMode: "kanvas_fixed",
  executionTransparency: "full",
  maximumCharge: {
    currencyCode: "USD",
    amount: "2.50",
  },
  routeCandidateDigest: digest("b"),
  requestScopeDigest: digest("c"),
  queryMode: "provider_request_id",
  notFoundIsAuthoritative: true,
});

const claim = Object.freeze<ProviderInvocationClaim>({
  workKind: "submit",
  invocationId: id(11),
  capabilityRunId: id(12),
  attemptId: id(13),
  workflowRunId: id(14),
  nodeRunId: id(15),
  workspaceId: id(16),
  actorId: id(18),
  implementationRevisionId: id(17),
  implementationDigest: digest("d"),
  adapterKey: "test.real-provider",
  route,
  input: {
    input: "test",
  },
  compiledOutputMapping: createIdentityCapabilityMappingPlanV1("output"),
  stableRequestKey: "kanvas:v1:provider-budget-test",
  requestFingerprint: digest("e"),
  leaseGeneration: 1,
  executionGeneration: 7,
  leaseExpiresAt: new Date(NOW.getTime() + 30_000),
  executionDeadlineAt: new Date(NOW.getTime() + 300_000),
});

function executionContext(
  budgetReservationId?: string,
): ProviderInvocationExecutionContext {
  return Object.freeze<ProviderInvocationExecutionContext>({
    invocationId: claim.invocationId,
    workspaceId: claim.workspaceId,
    route,
    implementationConfiguration: {},
    endpoint: {
      id: route.providerEndpointId,
      adapterKind: "openai_compatible",
      presetKind: "none",
      baseUrl: "https://provider.example/v1",
      canonicalOrigin: "https://provider.example",
      regionCode: "global",
      networkPolicy: {},
      dataPolicy: {},
    },
    model: {
      deploymentId: route.modelDeploymentId,
      providerModelId: "test-model",
      modelProfileRevisionId: route.modelProfileRevisionId,
      modelProfile: {},
    },
    pricing: {
      revisionId: route.pricingRevisionId,
      currencyCode: "USD",
      pricing: {
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
    },
    secret: {
      id: route.pinnedSecretVersionId,
      workspaceId: claim.workspaceId,
      credentialId: route.credentialIdentityId,
      version: 1,
      materialGeneration: 1,
      sourceKind: "deployment_reference",
      lifecycleStatus: "active",
      aadDigest: digest("f"),
      materialFingerprint: digest("0"),
      formatVersion: 1,
      drainDeadlineAt: null,
      deploymentReference: "deployment://provider/test",
    },
    ...(budgetReservationId ? { budgetReservationId } : {}),
  });
}

describe("Provider budget execution boundary", () => {
  it.each([false, true])(
    "releases only when generation never started (confirmed result: %s)",
    async (confirmedResult) => {
      const reservationId = id(31);
      const noQueryRoute = Object.freeze({
        ...route,
        queryMode: "none" as const,
        notFoundIsAuthoritative: false,
      });
      const boundClaim = Object.freeze({
        ...claim,
        route: noQueryRoute,
        budgetReservationId: reservationId,
      });
      const appendAndAdoptObservation = vi.fn(
        (options: AppendProviderObservationOptions) => {
          void options;
          return Promise.resolve({
            recorded: true,
            adoption: "applied" as const,
            terminal: true,
          });
        },
      );
      const finalize = vi.fn((options: FinalizeBudgetReservationOptions) =>
        Promise.resolve({
          status: "finalized" as const,
          reservationId: options.reservationId,
          lifecycleStatus: "released" as const,
          settledAmount: null,
          unknownHoldAmount: null,
          accountVersion: 2,
        }),
      );
      const adapter: AsyncProviderAdapter = {
        adapterKey: claim.adapterKey,
        queryMode: "none",
        notFoundIsAuthoritative: false,
        credentialMode: "provider-secret",
        submit: async (request) => {
          if (confirmedResult)
            await (
              request as AuthorizedProviderInvocationRequest
            ).onResultConfirmed?.({
              usage: [],
              reportedCharge: {
                source: "provider_reported",
                currencyCode: "USD",
                amount: "0.5",
              },
            });
          throw new ProviderAdapterCallError(
            "provider.transport_connect_failed",
            "not_started",
          );
        },
        query: () => Promise.reject(new Error("query is not expected")),
      };
      const runner = new ProviderInvocationRunner({
        runtime: {
          runtimeFence: {
            assertAllowed: () =>
              Promise.resolve({
                state: "ACTIVE" as const,
                executionGeneration: 7,
                stateVersion: 1,
              }),
          },
        } as unknown as ApplicationRuntime,
        store: {
          claimDispatch: vi.fn(),
          markSubmissionStarted: () => Promise.resolve(true),
          recordConfirmedResult: () => Promise.resolve(true),
          appendAndAdoptObservation,
          scanRecoveryCandidates: vi.fn(),
          claimRecovery: vi.fn(),
        },
        executionContexts: {
          resolve: () =>
            Promise.resolve({
              ...executionContext(reservationId),
              route: noQueryRoute,
            }),
        },
        secretResolver: {
          withResolvedMaterial: (_metadata, use) => {
            const material = Buffer.from("test-secret", "utf8");
            return use(material).finally(() => material.fill(0));
          },
        },
        budgets: {
          reserve: vi.fn(),
          finalize,
          resolveUnknown: vi.fn(),
        },
        adapters: createProviderAdapterRegistry([adapter]),
        nextId: (() => {
          let value = 400;
          return () => id(value++);
        })(),
        now: () => NOW,
      });

      await expect(
        runner.run({
          claim: boundClaim,
          leaseTokenHash: "d".repeat(64),
          source: "consumer",
        }),
      ).resolves.toMatchObject({
        executionStatus: "observed",
        status: "failed",
      });
      if (confirmedResult) {
        expect(appendAndAdoptObservation.mock.calls[0]?.[0]).not.toHaveProperty(
          "callEffect",
        );
        expect(finalize).not.toHaveBeenCalled();
        return;
      }
      expect(appendAndAdoptObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          callEffect: "not_started",
        }),
      );
      expect(finalize).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationId,
          kind: "release",
        }),
      );
    },
  );

  it("adopts missing secret material as a terminal manual failure", async () => {
    const appendAndAdoptObservation = vi.fn(
      (options: AppendProviderObservationOptions) =>
        Promise.resolve({
          recorded: true,
          adoption: "applied" as const,
          terminal: options.status === "failed",
        }),
    );
    const runner = new ProviderInvocationRunner({
      runtime: {
        runtimeFence: {
          assertAllowed: () =>
            Promise.resolve({
              state: "ACTIVE" as const,
              executionGeneration: 7,
              stateVersion: 1,
            }),
        },
      } as unknown as ApplicationRuntime,
      store: {
        claimDispatch: vi.fn(),
        markSubmissionStarted: vi.fn(),
        appendAndAdoptObservation,
        scanRecoveryCandidates: vi.fn(),
        claimRecovery: vi.fn(),
      },
      executionContexts: {
        resolve: (options) =>
          Promise.resolve(executionContext(options.claim.budgetReservationId)),
      },
      secretResolver: {
        withResolvedMaterial: () => {
          const error = new Error(
            "Pinned KEK version is not mapped in this deployment.",
          );
          error.name = "ProviderSecretResolutionError";
          return Promise.reject(
            Object.assign(error, {
              code: "provider.secret_resolution_failed" as const,
            }),
          );
        },
      },
      budgets: {
        reserve: (options) =>
          Promise.resolve({
            status: "reserved" as const,
            reservationId: options.reservationId,
            lifecycleStatus: "reserved" as const,
            reservedAmount: options.maximumChargeAmount,
            accountVersion: 2,
          }),
        finalize: vi.fn(),
        resolveUnknown: vi.fn(),
      },
      adapters: createProviderAdapterRegistry([
        {
          adapterKey: claim.adapterKey,
          queryMode: "provider_request_id",
          notFoundIsAuthoritative: true,
          credentialMode: "provider-secret",
          submit: () => Promise.reject(new Error("submit is not expected")),
          query: () => Promise.reject(new Error("query is not expected")),
        },
      ]),
      nextId: (() => {
        let value = 600;
        return () => id(value++);
      })(),
      now: () => NOW,
    });

    await expect(
      runner.run({
        claim,
        leaseTokenHash: "f".repeat(64),
        source: "consumer",
      }),
    ).resolves.toMatchObject({
      executionStatus: "observed",
      status: "failed",
    });
    expect(appendAndAdoptObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        stableErrorCode: "provider.secret_resolution_failed",
        retryability: "manual",
      }),
    );
  });

  it("reserves and binds the maximum charge before submission intent and secret use", async () => {
    const order: string[] = [];
    let reservationId: string | undefined;
    let callbackMaterial: Uint8Array | undefined;
    const contextStore: ProviderExecutionContextStore = {
      resolve: vi.fn(
        (options: ResolveProviderInvocationExecutionContextOptions) => {
          order.push(
            options.claim.budgetReservationId
              ? "context-bound"
              : "context-unbound",
          );
          return Promise.resolve(
            executionContext(options.claim.budgetReservationId),
          );
        },
      ),
    };
    const budgetStore: BudgetReservationStore = {
      reserve: vi.fn((options: ReserveBudgetOptions) => {
        order.push("budget-reserved");
        reservationId = options.reservationId;
        expect(options).toMatchObject({
          budgetAccountId: route.budgetAccountId,
          providerInvocationId: claim.invocationId,
          requestDigest: claim.requestFingerprint,
          maximumChargeAmount: "2.50",
          currencyCode: "USD",
          expiresAt: claim.executionDeadlineAt,
        });
        return Promise.resolve({
          status: "reserved" as const,
          reservationId: options.reservationId,
          lifecycleStatus: "reserved" as const,
          reservedAmount: "2.5",
          accountVersion: 2,
        });
      }),
      finalize: vi.fn(),
      resolveUnknown: vi.fn(),
    };
    const secretResolver: ProviderSecretMaterialResolver = {
      withResolvedMaterial: async (_metadata, use) => {
        order.push("secret-resolved");
        const material = Buffer.from("test-secret", "utf8");
        callbackMaterial = material;
        try {
          return await use(material);
        } finally {
          material.fill(0);
        }
      },
    };
    const adapter: AsyncProviderAdapter = {
      adapterKey: claim.adapterKey,
      queryMode: "provider_request_id",
      notFoundIsAuthoritative: true,
      credentialMode: "provider-secret",
      submit: (request) => {
        order.push("remote-submit");
        const authorized = request as typeof request & {
          readonly credential: Uint8Array;
        };
        expect(Buffer.from(authorized.credential).toString("utf8")).toBe(
          "test-secret",
        );
        return Promise.resolve({
          observationKey: "submit:provider-request-1:running",
          status: "running",
          providerRequestId: "provider-request-1",
        });
      },
      query: () => Promise.reject(new Error("query is not expected")),
    };
    const store: ProviderInvocationStore = {
      claimDispatch: vi.fn(),
      markSubmissionStarted: vi.fn(() => {
        order.push("submission-intent");
        return Promise.resolve(true);
      }),
      appendAndAdoptObservation: vi.fn(() =>
        Promise.resolve({
          recorded: true,
          adoption: "applied" as const,
          terminal: false,
        }),
      ),
      scanRecoveryCandidates: vi.fn(),
      claimRecovery: vi.fn(),
    };
    let nextIdValue = 100;
    const runner = new ProviderInvocationRunner({
      runtime: {
        runtimeFence: {
          assertAllowed: () =>
            Promise.resolve({
              state: "ACTIVE" as const,
              executionGeneration: 7,
              stateVersion: 1,
            }),
        },
      } as unknown as ApplicationRuntime,
      store,
      executionContexts: contextStore,
      secretResolver,
      budgets: budgetStore,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: () => id(nextIdValue++),
      now: () => NOW,
      reconcileDelayMs: 5_000,
    });

    await expect(
      runner.run({
        claim,
        leaseTokenHash: "a".repeat(64),
        source: "consumer",
      }),
    ).resolves.toMatchObject({
      executionStatus: "observed",
      status: "running",
    });
    expect(reservationId).toBeDefined();
    expect(order).toEqual([
      "context-unbound",
      "budget-reserved",
      "context-bound",
      "secret-resolved",
      "submission-intent",
      "remote-submit",
    ]);
    expect([...(callbackMaterial ?? [])].every((byte) => byte === 0)).toBe(
      true,
    );
  });

  it("moves a successful but not yet priced invocation into an idempotent unknown hold", async () => {
    const boundReservationId = id(30);
    const boundClaim = Object.freeze<ProviderInvocationClaim>({
      ...claim,
      budgetReservationId: boundReservationId,
    });
    const finalize = vi.fn((options: FinalizeBudgetReservationOptions) =>
      Promise.resolve({
        status: "finalized" as const,
        reservationId: options.reservationId,
        lifecycleStatus: "unknown" as const,
        settledAmount: null,
        unknownHoldAmount: route.maximumCharge.amount,
        accountVersion: 3,
      }),
    );
    const budgetStore: BudgetReservationStore = {
      reserve: vi.fn(),
      finalize,
      resolveUnknown: vi.fn(),
    };
    const contextStore: ProviderExecutionContextStore = {
      resolve: () => Promise.resolve(executionContext(boundReservationId)),
    };
    const secretResolver: ProviderSecretMaterialResolver = {
      withResolvedMaterial: (_metadata, use) => {
        const material = Buffer.from("test-secret", "utf8");
        return use(material).finally(() => material.fill(0));
      },
    };
    const adapter: AsyncProviderAdapter = {
      adapterKey: claim.adapterKey,
      queryMode: "provider_request_id",
      notFoundIsAuthoritative: true,
      credentialMode: "provider-secret",
      submit: () =>
        Promise.resolve({
          observationKey: "submit:provider-request-2:completed",
          status: "succeeded",
          providerRequestId: "provider-request-2",
          output: {
            id: "provider-request-2",
            status: "completed",
          },
          usage: [
            {
              metricKey: "input_tokens",
              numericValue: "12",
              unitCode: "token",
            },
          ],
        }),
      query: () => Promise.reject(new Error("query is not expected")),
    };
    const appendAndAdoptObservation = vi.fn(
      (options: AppendProviderObservationOptions) => {
        void options;
        return Promise.resolve({
          recorded: true,
          adoption: "applied" as const,
          terminal: true,
        });
      },
    );
    const store: ProviderInvocationStore = {
      claimDispatch: vi.fn(),
      markSubmissionStarted: () => Promise.resolve(true),
      appendAndAdoptObservation,
      scanRecoveryCandidates: vi.fn(),
      claimRecovery: vi.fn(),
    };
    let nextIdValue = 200;
    const runner = new ProviderInvocationRunner({
      runtime: {
        runtimeFence: {
          assertAllowed: () =>
            Promise.resolve({
              state: "ACTIVE" as const,
              executionGeneration: 7,
              stateVersion: 1,
            }),
        },
      } as unknown as ApplicationRuntime,
      store,
      executionContexts: contextStore,
      secretResolver,
      budgets: budgetStore,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: () => id(nextIdValue++),
      now: () => NOW,
    });

    await expect(
      runner.run({
        claim: boundClaim,
        leaseTokenHash: "b".repeat(64),
        source: "consumer",
      }),
    ).resolves.toMatchObject({
      executionStatus: "observed",
      status: "succeeded",
    });
    expect(finalize).toHaveBeenCalledOnce();
    const adopted = appendAndAdoptObservation.mock.calls[0]?.[0];
    expect(adopted?.status).toBe("succeeded");
    if (adopted?.status !== "succeeded") {
      throw new Error("Succeeded observation was not captured.");
    }
    expect(adopted.initialUsage).toHaveLength(1);
    expect(adopted.initialUsage?.[0]).toMatchObject({
      entryKey: `provider:${claim.invocationId}:input_tokens`,
      metricKey: "input_tokens",
      sourceKind: "provider_reported",
      providerInvocationId: claim.invocationId,
      pricingRevisionId: route.pricingRevisionId,
      valueDimension: "quantity",
      unitCode: "token",
      entryKind: "observation",
      numericValue: "12",
    });
    expect(adopted.initialUsage?.[0]?.id).toMatch(
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u,
    );
    const settlement = finalize.mock.calls[0]?.[0];
    expect(settlement).toMatchObject({
      workspaceId: claim.workspaceId,
      budgetAccountId: route.budgetAccountId,
      reservationId: boundReservationId,
      requestDigest: claim.requestFingerprint,
      kind: "unknown_hold",
      ledgerEntryKey: `provider-terminal:${claim.invocationId}`,
    });
  });

  it("captures and records a trusted provider-reported monetary charge within the risk ceiling", async () => {
    const boundReservationId = id(31);
    const boundClaim = Object.freeze<ProviderInvocationClaim>({
      ...claim,
      budgetReservationId: boundReservationId,
    });
    const finalize = vi.fn((options: FinalizeBudgetReservationOptions) =>
      Promise.resolve({
        status: "finalized" as const,
        reservationId: options.reservationId,
        lifecycleStatus: "settled" as const,
        settledAmount: options.capturedAmount ?? null,
        unknownHoldAmount: null,
        accountVersion: 4,
      }),
    );
    const appendAndAdoptObservation = vi.fn(
      (options: AppendProviderObservationOptions) => {
        void options;
        return Promise.resolve({
          recorded: true,
          adoption: "applied" as const,
          terminal: true,
        });
      },
    );
    const adapter: AsyncProviderAdapter = {
      adapterKey: claim.adapterKey,
      queryMode: "provider_request_id",
      notFoundIsAuthoritative: true,
      credentialMode: "provider-secret",
      submit: () =>
        Promise.resolve({
          observationKey: "submit:provider-request-3:completed",
          status: "succeeded",
          providerRequestId: "provider-request-3",
          output: {
            id: "provider-request-3",
            status: "completed",
          },
          usage: [
            {
              metricKey: "output_images",
              numericValue: "1",
              unitCode: "image",
            },
          ],
          reportedCharge: {
            source: "provider_reported",
            currencyCode: "USD",
            amount: "0.75",
          },
        }),
      query: () => Promise.reject(new Error("query is not expected")),
    };
    const runner = new ProviderInvocationRunner({
      runtime: {
        runtimeFence: {
          assertAllowed: () =>
            Promise.resolve({
              state: "ACTIVE" as const,
              executionGeneration: 7,
              stateVersion: 1,
            }),
        },
      } as unknown as ApplicationRuntime,
      store: {
        claimDispatch: vi.fn(),
        markSubmissionStarted: () => Promise.resolve(true),
        appendAndAdoptObservation,
        scanRecoveryCandidates: vi.fn(),
        claimRecovery: vi.fn(),
      },
      executionContexts: {
        resolve: () => Promise.resolve(executionContext(boundReservationId)),
      },
      secretResolver: {
        withResolvedMaterial: (_metadata, use) => {
          const material = Buffer.from("test-secret", "utf8");
          return use(material).finally(() => material.fill(0));
        },
      },
      budgets: {
        reserve: vi.fn(),
        finalize,
        resolveUnknown: vi.fn(),
      },
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: (() => {
        let value = 300;
        return () => id(value++);
      })(),
      now: () => NOW,
    });

    await expect(
      runner.run({
        claim: boundClaim,
        leaseTokenHash: "c".repeat(64),
        source: "consumer",
      }),
    ).resolves.toMatchObject({
      executionStatus: "observed",
      status: "succeeded",
    });
    expect(finalize).toHaveBeenCalledOnce();
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({
      kind: "capture",
      reservationId: boundReservationId,
      capturedAmount: "0.75",
    });
    const adopted = appendAndAdoptObservation.mock.calls[0]?.[0];
    expect(adopted?.status).toBe("succeeded");
    if (adopted?.status !== "succeeded") {
      throw new Error("Succeeded observation was not captured.");
    }
    expect(adopted.initialUsage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryKey: `provider:${claim.invocationId}:reported-charge`,
          metricKey: "provider_reported_charge",
          sourceKind: "provider_reported",
          valueDimension: "money",
          currencyCode: "USD",
          entryKind: "observation",
          numericValue: "0.75",
        }),
        expect.objectContaining({
          metricKey: "output_images",
          valueDimension: "quantity",
          unitCode: "image",
          numericValue: "1",
        }),
      ]),
    );
    const reportedMoney = adopted.initialUsage?.find(
      (entry) => entry.metricKey === "provider_reported_charge",
    );
    expect(reportedMoney?.evidenceDigest).toBe(
      digestProviderValue({
        responseDigest: digestProviderValue({
          id: "provider-request-3",
          status: "completed",
        }),
        reportedCharge: {
          source: "provider_reported",
          currencyCode: "USD",
          amount: "0.75",
        },
      }),
    );
  });

  it("holds the maximum reservation when a trusted reported charge exceeds the pinned maximum", async () => {
    const boundReservationId = id(31);
    const boundClaim = Object.freeze<ProviderInvocationClaim>({
      ...claim,
      budgetReservationId: boundReservationId,
    });
    const finalize = vi.fn((options: FinalizeBudgetReservationOptions) =>
      Promise.resolve({
        status: "finalized" as const,
        reservationId: options.reservationId,
        lifecycleStatus: "unknown" as const,
        settledAmount: null,
        unknownHoldAmount: route.maximumCharge.amount,
        accountVersion: 4,
      }),
    );
    const adapter: AsyncProviderAdapter = {
      adapterKey: claim.adapterKey,
      queryMode: "provider_request_id",
      notFoundIsAuthoritative: true,
      credentialMode: "provider-secret",
      submit: () =>
        Promise.resolve({
          observationKey: "submit:provider-request-3:completed",
          status: "succeeded",
          providerRequestId: "provider-request-3",
          output: {
            id: "provider-request-3",
            status: "completed",
          },
          reportedCharge: {
            source: "provider_reported",
            currencyCode: "USD",
            amount: "3",
          },
        }),
      query: () => Promise.reject(new Error("query is not expected")),
    };
    const runner = new ProviderInvocationRunner({
      runtime: {
        runtimeFence: {
          assertAllowed: () =>
            Promise.resolve({
              state: "ACTIVE" as const,
              executionGeneration: 7,
              stateVersion: 1,
            }),
        },
      } as unknown as ApplicationRuntime,
      store: {
        claimDispatch: vi.fn(),
        markSubmissionStarted: () => Promise.resolve(true),
        appendAndAdoptObservation: () =>
          Promise.resolve({
            recorded: true,
            adoption: "applied" as const,
            terminal: true,
          }),
        scanRecoveryCandidates: vi.fn(),
        claimRecovery: vi.fn(),
      },
      executionContexts: {
        resolve: () => Promise.resolve(executionContext(boundReservationId)),
      },
      secretResolver: {
        withResolvedMaterial: (_metadata, use) => {
          const material = Buffer.from("test-secret", "utf8");
          return use(material).finally(() => material.fill(0));
        },
      },
      budgets: {
        reserve: vi.fn(),
        finalize,
        resolveUnknown: vi.fn(),
      },
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: (() => {
        let value = 300;
        return () => id(value++);
      })(),
      now: () => NOW,
    });

    await expect(
      runner.run({
        claim: boundClaim,
        leaseTokenHash: "c".repeat(64),
        source: "consumer",
      }),
    ).resolves.toMatchObject({
      executionStatus: "observed",
      status: "succeeded",
    });
    expect(finalize).toHaveBeenCalledOnce();
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({
      kind: "unknown_hold",
      reservationId: boundReservationId,
    });
  });
});

describe("image storage preflight", () => {
  it.each([false, true])(
    "does not submit or reserve when storage is unavailable; existing reservation %s",
    async (reserved) => {
      const submit = vi.fn();
      const reserve = vi.fn();
      const finalize = vi.fn();
      const markSubmissionStarted = vi.fn();
      const appendAndAdoptObservation = vi.fn().mockResolvedValue({
        recorded: true,
        terminal: true,
        adoption: "applied",
      });
      const runner = new ProviderInvocationRunner({
        runtime: {
          runtimeFence: { assertAllowed: vi.fn() },
        } as unknown as ApplicationRuntime,
        store: {
          markSubmissionStarted,
          appendAndAdoptObservation,
        } as unknown as ProviderInvocationStore,
        preflight: () => Promise.reject(new Error("storage unavailable")),
        executionContexts: {
          resolve: () =>
            Promise.resolve(executionContext(reserved ? id(999) : undefined)),
        },
        secretResolver: { withResolvedMaterial: vi.fn() },
        budgets: { reserve, finalize, resolveUnknown: vi.fn() },
        adapters: createProviderAdapterRegistry([
          {
            adapterKey: claim.adapterKey,
            queryMode: route.queryMode,
            notFoundIsAuthoritative: route.notFoundIsAuthoritative,
            credentialMode: "provider-secret",
            submit,
            query: vi.fn(),
          },
        ]),
        nextId: () => id(800),
        now: () => NOW,
      });
      await expect(
        runner.run({
          claim: {
            ...claim,
            ...(reserved ? { budgetReservationId: id(999) } : {}),
          },
          leaseTokenHash: "a".repeat(64),
          source: "consumer",
        }),
      ).resolves.toMatchObject({ status: "failed" });
      expect(submit).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
      expect(markSubmissionStarted).not.toHaveBeenCalled();
      expect(appendAndAdoptObservation.mock.calls[0]?.[0]).toMatchObject({
        stableErrorCode: "provider.storage_preflight_failed",
        callEffect: "not_started",
        retryability: "manual",
      });
      if (reserved)
        expect(finalize.mock.calls[0]?.[0]).toMatchObject({ kind: "release" });
      else expect(finalize).not.toHaveBeenCalled();
    },
  );
});
