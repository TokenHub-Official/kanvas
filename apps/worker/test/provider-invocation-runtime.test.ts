import {
  RuntimeFenceRejectedError,
  type ApplicationRuntime,
  type ProviderRouteSnapshot,
  type RuntimeStateReader,
} from "@kanvas/application";
import {
  digestProviderValue,
  ProviderInvocationStoreError,
  type AppendProviderObservationOptions,
  type ClaimProviderDispatchOptions,
  type ProviderInvocationClaim,
  type ProviderInvocationStore,
} from "@kanvas/database/runtime";
import { createIdentityCapabilityMappingPlanV1 } from "@kanvas/contracts/capability";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { FakeAsyncProviderAdapter } from "../src/provider/fake-async-provider.js";
import {
  ProviderAdapterCallError,
  ProviderAdapterContractError,
  createProviderAdapterRegistry,
  type AsyncProviderAdapter,
  type ProviderQueryRequest,
  type ProviderObservation,
} from "../src/provider/provider-adapter.js";
import { ProviderAttemptProcessor } from "../src/provider/provider-attempt-processor.js";
import { ProviderInvocationRunner } from "../src/provider/provider-invocation-runner.js";
import { ProviderInvocationReconciler } from "../src/reconciler/provider-invocation-reconciler.js";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const ACTIVE_SNAPSHOT = Object.freeze({
  state: "ACTIVE" as const,
  executionGeneration: 7,
  stateVersion: 1,
});

function ulid(suffix: string): string {
  return `01J${"0".repeat(23 - suffix.length)}${suffix}`;
}

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

const ids = Object.freeze({
  workspace: ulid("1"),
  workflowRun: ulid("2"),
  nodeRun: ulid("3"),
  capabilityRun: ulid("4"),
  attempt: ulid("5"),
  dispatchEvent: ulid("6"),
  implementationRevision: ulid("7"),
  invocation: ulid("8"),
  observation: ulid("9"),
  terminalEvent: ulid("10"),
  secondInvocation: ulid("11"),
  secondObservation: ulid("12"),
  secondTerminalEvent: ulid("13"),
  completion: ulid("14"),
  secondCompletion: ulid("15"),
  nextAttempt: ulid("16"),
});

const route = Object.freeze<ProviderRouteSnapshot>({
  providerProtocolVersion: 1,
  providerKey: "fake",
  apiSurface: "async-test",
  providerEndpointId: ulid("20"),
  credentialIdentityId: ulid("21"),
  credentialIdentityEpoch: 1,
  modelDeploymentId: ulid("22"),
  pricingRevisionId: ulid("23"),
  pinnedSecretVersionId: ulid("24"),
  credentialIdentityDigest: digest("c"),
  instancePolicyRevisionId: ulid("25"),
  workspacePolicyRevisionId: ulid("26"),
  routePolicyRevisionId: ulid("27"),
  modelProfileRevisionId: ulid("28"),
  budgetAccountId: ulid("29"),
  routingMode: "kanvas_fixed",
  executionTransparency: "full",
  maximumCharge: Object.freeze({ currencyCode: "USD", amount: "1" }),
  routeCandidateDigest: digest("a"),
  requestScopeDigest: digest("b"),
  queryMode: "client_request_id",
  notFoundIsAuthoritative: true,
});

interface ProviderDispatchEnvelope {
  readonly outboxEventId: string;
  readonly workspaceId: string;
  readonly schemaVersion: 1;
  readonly messageType: "attempt.dispatch.requested";
  readonly aggregateType: "capability_attempt";
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly expectedGeneration: number;
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly executionTarget: "provider";
}

function providerDispatchEnvelope(): ProviderDispatchEnvelope {
  return Object.freeze({
    outboxEventId: ids.dispatchEvent,
    workspaceId: ids.workspace,
    schemaVersion: 1,
    messageType: "attempt.dispatch.requested",
    aggregateType: "capability_attempt",
    aggregateId: ids.attempt,
    aggregateVersion: 1,
    expectedGeneration: 7,
    workflowRunId: ids.workflowRun,
    nodeRunId: ids.nodeRun,
    capabilityRunId: ids.capabilityRun,
    attemptId: ids.attempt,
    executionTarget: "provider",
  });
}

function canonicalEvent(envelope: ProviderDispatchEnvelope) {
  return Object.freeze({
    eventId: envelope.outboxEventId,
    workspaceId: envelope.workspaceId,
    messageType: envelope.messageType,
    schemaVersion: envelope.schemaVersion,
    aggregateType: envelope.aggregateType,
    aggregateId: envelope.aggregateId,
    aggregateVersion: envelope.aggregateVersion,
    expectedGeneration: envelope.expectedGeneration,
    payload: envelope,
  });
}

function processedClaimResult(
  envelope: ProviderDispatchEnvelope,
  value: ProviderInvocationClaim | undefined,
) {
  return Object.freeze({
    deliveryStatus: "processed" as const,
    event: canonicalEvent(envelope),
    outcome: value === undefined ? ("noop" as const) : ("applied" as const),
    resultCode:
      value === undefined
        ? "provider.dispatch.noop"
        : "provider.dispatch.claimed",
    value,
  });
}

function duplicateClaimResult(envelope: ProviderDispatchEnvelope) {
  return Object.freeze({
    deliveryStatus: "duplicate" as const,
    event: canonicalEvent(envelope),
    outcome: "applied" as const,
    resultCode: "provider.dispatch.claimed",
  });
}

function invocationClaim(
  overrides: Partial<ProviderInvocationClaim> = {},
): ProviderInvocationClaim {
  return Object.freeze({
    workKind: "submit",
    invocationId: ids.invocation,
    capabilityRunId: ids.capabilityRun,
    attemptId: ids.attempt,
    workflowRunId: ids.workflowRun,
    nodeRunId: ids.nodeRun,
    workspaceId: ids.workspace,
    actorId: ulid("17"),
    implementationRevisionId: ids.implementationRevision,
    implementationDigest: digest("9"),
    adapterKey: "fake.async.provider",
    route,
    input: {
      prompt: "render a product",
    },
    compiledOutputMapping: createIdentityCapabilityMappingPlanV1("output"),
    stableRequestKey: "kanvas:v1:provider-attempt",
    requestFingerprint: digest("c"),
    leaseGeneration: 1,
    executionGeneration: 7,
    leaseExpiresAt: new Date("2026-07-27T12:00:30.000Z"),
    ...overrides,
  });
}

function createRuntime(
  assertAllowed = vi.fn().mockResolvedValue(ACTIVE_SNAPSHOT),
): ApplicationRuntime {
  return {
    runtimeFence: {
      assertAllowed,
    },
  } as unknown as ApplicationRuntime;
}

function createRuntimeStateReader(): RuntimeStateReader {
  return {
    read: () => Promise.resolve(ACTIVE_SNAPSHOT),
  };
}

function expectedDelivery(envelope: ProviderDispatchEnvelope) {
  return {
    consumerName: "provider-attempt-dispatch.v1",
    eventId: envelope.outboxEventId,
    workspaceId: envelope.workspaceId,
    schemaVersion: 1,
    messageType: envelope.messageType,
    aggregateType: envelope.aggregateType,
    aggregateId: envelope.aggregateId,
    aggregateVersion: envelope.aggregateVersion,
    expectedGeneration: envelope.expectedGeneration,
    receivedAt: NOW,
  };
}

function observationAdopted(terminal = false) {
  return Object.freeze({
    recorded: true,
    adoption: "applied" as const,
    terminal,
  });
}

function requireDefined<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new Error(`${field} was not captured.`);
  }
  return value;
}

describe("Provider invocation runtime", () => {
  it("terminates a deterministic Provider admission rejection before side effects", async () => {
    const envelope = providerDispatchEnvelope();
    const reportAttemptFailure = vi.fn(() =>
      Promise.resolve({
        status: "failed" as const,
        reasonCode: "attempt.transition.blocked.retryability_terminal",
      }),
    );
    const processor = new ProviderAttemptProcessor({
      runtime: createRuntime(),
      store: {
        claimDispatch: vi
          .fn()
          .mockRejectedValue(
            new ProviderInvocationStoreError(
              "provider_invocation.snapshot_invalid",
              "Provider parameter resolution failed.",
            ),
          ),
      } as unknown as ProviderInvocationStore,
      attemptFailures: {
        reportAttemptFailure,
      },
      adapters: createProviderAdapterRegistry([new FakeAsyncProviderAdapter()]),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.invocation)
        .mockReturnValueOnce(ids.nextAttempt)
        .mockReturnValueOnce(ids.terminalEvent),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toEqual({
      claimed: false,
      deliveryStatus: "processed",
      resultCode: "provider.dispatch.failed",
    });
    expect(reportAttemptFailure).toHaveBeenCalledWith({
      workspaceId: ids.workspace,
      capabilityRunId: ids.capabilityRun,
      attemptId: ids.attempt,
      nextAttemptId: ids.nextAttempt,
      outboxEventId: ids.terminalEvent,
      executionGeneration: 7,
      target: {
        reporter: "reconciler",
        executionTarget: "provider",
        expectedAttemptVersion: 1,
      },
      failure: {
        stableErrorCode: "provider.parameter_resolution_rejected",
        sideEffectState: "not_started",
        retryability: "terminal",
        cause: "failed",
      },
      now: NOW,
    });
  });

  it("persists a prepared request before submission and reuses it after a lost lease", async () => {
    const preparedSnapshot = Object.freeze({
      schemaVersion: 1,
      operation: "image.generate",
      body: Object.freeze({
        model: "gpt-image-2",
        quality: "high",
        resolution: "2k",
      }),
    });
    const preparedDigest = digestProviderValue(preparedSnapshot);
    const order: string[] = [];
    const prepare = vi.fn(() => {
      order.push("prepare");
      return Object.freeze({
        snapshot: preparedSnapshot,
      });
    });
    const submit = vi.fn(
      (request: Parameters<AsyncProviderAdapter["submit"]>[0]) => {
        order.push("submit");
        expect(request.preparedRequestSnapshot).toBe(preparedSnapshot);
        expect(request.preparedRequestDigest).toBe(preparedDigest);
        return Promise.resolve({
          observationKey: "submit:prepared-request:running",
          status: "running" as const,
          providerRequestId: "prepared-request",
        });
      },
    );
    const adapter: AsyncProviderAdapter = {
      adapterKey: "fake.async.provider",
      queryMode: "client_request_id",
      notFoundIsAuthoritative: true,
      prepare,
      submit,
      query: () => Promise.reject(new Error("Query was not expected.")),
    };
    const recorded: Array<{
      readonly snapshot: Readonly<Record<string, unknown>>;
      readonly digest: string;
    }> = [];
    const recordPreparedRequest = vi.fn(
      (options: {
        readonly snapshot: Readonly<Record<string, unknown>>;
        readonly digest: string;
      }) => {
        order.push("record");
        recorded.push({
          snapshot: options.snapshot,
          digest: options.digest,
        });
        return Promise.resolve(true);
      },
    );
    const markSubmissionStarted = vi
      .fn(() => {
        order.push("mark");
        return Promise.resolve(false);
      })
      .mockImplementationOnce(() => {
        order.push("mark");
        return Promise.resolve(false);
      })
      .mockImplementationOnce(() => {
        order.push("mark");
        return Promise.resolve(true);
      });
    const appendAndAdoptObservation = vi.fn(() => {
      order.push("adopt");
      return Promise.resolve(observationAdopted());
    });
    const store = {
      recordPreparedRequest,
      markSubmissionStarted,
      appendAndAdoptObservation,
    } as unknown as ProviderInvocationStore;
    const runner = new ProviderInvocationRunner({
      runtime: createRuntime(),
      store,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: () => ids.observation,
      now: () => NOW,
    });
    const firstClaim = invocationClaim({
      effectiveParameters: {
        quality: "high",
        resolution: "2k",
      },
      parameterResolutionDigest: digest("d"),
    });

    await expect(
      runner.run({
        claim: firstClaim,
        leaseTokenHash: "a".repeat(64),
        source: "consumer",
      }),
    ).resolves.toEqual({
      executionStatus: "lease_lost",
      workKind: "submit",
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    expect(recorded).toEqual([
      {
        snapshot: preparedSnapshot,
        digest: preparedDigest,
      },
    ]);
    expect(order).toEqual(["prepare", "record", "mark"]);

    const retryClaim = invocationClaim({
      effectiveParameters: {
        quality: "high",
        resolution: "2k",
      },
      parameterResolutionDigest: digest("d"),
      preparedRequestSnapshot: preparedSnapshot,
      preparedRequestDigest: preparedDigest,
      leaseGeneration: 2,
    });
    await expect(
      runner.run({
        claim: retryClaim,
        leaseTokenHash: "b".repeat(64),
        source: "reconciler",
      }),
    ).resolves.toMatchObject({
      executionStatus: "observed",
      workKind: "submit",
      status: "running",
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(recorded).toEqual([
      {
        snapshot: preparedSnapshot,
        digest: preparedDigest,
      },
      {
        snapshot: preparedSnapshot,
        digest: preparedDigest,
      },
    ]);
    expect(order).toEqual([
      "prepare",
      "record",
      "mark",
      "record",
      "mark",
      "submit",
      "adopt",
    ]);
  });

  it("submits a claimed Provider attempt and adopts a running observation", async () => {
    const envelope = providerDispatchEnvelope();
    const claim = invocationClaim();
    const adapter = new FakeAsyncProviderAdapter({
      nextProviderRequestId: () => "provider-request-1",
    });
    const fenceActions: string[] = [];
    const assertAllowed = vi.fn(
      (check: {
        readonly action: string;
        readonly expectedGeneration: number;
      }) => {
        fenceActions.push(check.action);
        return Promise.resolve(ACTIVE_SNAPSHOT);
      },
    );
    let capturedClaim: ClaimProviderDispatchOptions | undefined;
    const claimDispatch = vi.fn((options: ClaimProviderDispatchOptions) => {
      capturedClaim = options;
      return Promise.resolve(processedClaimResult(envelope, claim));
    });
    const markSubmissionStarted = vi.fn().mockResolvedValue(true);
    const appendAndAdoptObservation = vi
      .fn()
      .mockResolvedValue(observationAdopted());
    const processor = new ProviderAttemptProcessor({
      runtime: createRuntime(assertAllowed),
      store: {
        claimDispatch,
        markSubmissionStarted,
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.invocation)
        .mockReturnValueOnce(ids.observation),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      invocationId: ids.invocation,
      run: {
        executionStatus: "observed",
        workKind: "submit",
        status: "running",
      },
    });
    const claimOptions = requireDefined(
      capturedClaim,
      "Provider dispatch claim",
    );
    const { leaseTokenHash } = claimOptions;
    expect(leaseTokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(claimOptions).toEqual({
      invocationId: ids.invocation,
      capabilityRunId: ids.capabilityRun,
      attemptId: ids.attempt,
      leaseTokenHash,
      now: NOW,
      leaseUntil: new Date("2026-07-27T12:00:30.000Z"),
      executionGeneration: 7,
      delivery: expectedDelivery(envelope),
    });
    expect(markSubmissionStarted).toHaveBeenCalledWith({
      invocationId: ids.invocation,
      capabilityRunId: ids.capabilityRun,
      attemptId: ids.attempt,
      leaseTokenHash,
      leaseGeneration: 1,
      executionGeneration: 7,
      now: NOW,
    });
    expect(appendAndAdoptObservation).toHaveBeenCalledWith({
      observationId: ids.observation,
      observationKey: "submit:provider-request-1:running",
      invocationId: ids.invocation,
      capabilityRunId: ids.capabilityRun,
      attemptId: ids.attempt,
      leaseTokenHash,
      leaseGeneration: 1,
      executionGeneration: 7,
      operationKind: "invoke",
      source: "consumer",
      status: "running",
      providerRequestId: "provider-request-1",
      requestDigest: digest("c"),
      nextReconcileAt: new Date("2026-07-27T12:00:05.000Z"),
      observedAt: NOW,
      recordedAt: NOW,
    });
    expect(fenceActions).toEqual(["claim", "provider-call", "provider-call"]);
    expect(adapter.stats()).toEqual({
      remoteCreateCount: 1,
      submitCallCount: 1,
      queryCallCount: 0,
    });
  });

  it("records unknown when the Provider accepted before the response was lost", async () => {
    const envelope = providerDispatchEnvelope();
    const adapter = new FakeAsyncProviderAdapter();
    adapter.failNextAt("after_accept_before_response");
    const appendAndAdoptObservation = vi
      .fn()
      .mockResolvedValue(observationAdopted());
    const processor = new ProviderAttemptProcessor({
      runtime: createRuntime(),
      store: {
        claimDispatch: vi
          .fn()
          .mockResolvedValue(processedClaimResult(envelope, invocationClaim())),
        markSubmissionStarted: vi.fn().mockResolvedValue(true),
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.invocation)
        .mockReturnValueOnce(ids.observation),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      run: {
        executionStatus: "observed",
        status: "unknown",
      },
    });
    expect(appendAndAdoptObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        observationId: ids.observation,
        status: "unknown",
        stableErrorCode: "fake.after_accept_before_response",
        nextReconcileAt: new Date("2026-07-27T12:00:05.000Z"),
      }),
    );
    expect(adapter.stats()).toMatchObject({
      remoteCreateCount: 1,
      submitCallCount: 1,
    });
  });

  it("passes only the Adapter allowlisted retryability into a terminal failure observation", async () => {
    const envelope = providerDispatchEnvelope();
    const appendAndAdoptObservation = vi
      .fn()
      .mockResolvedValue(observationAdopted(true));
    const adapter: AsyncProviderAdapter = {
      adapterKey: "fake.async.provider",
      queryMode: "client_request_id",
      notFoundIsAuthoritative: true,
      failureRetryability: {
        "provider.invalid_request": "terminal",
      },
      submit() {
        return Promise.resolve({
          observationKey: "submit:invalid-request",
          status: "failed",
          stableErrorCode: "provider.invalid_request",
          upstreamError: {
            statusCode: 400,
            requestId: "tokenhub-request-123",
            body: '{"code":"invalid_request","message":"image is not allowed"}',
          },
          // A runtime payload cannot self-promote its classification.
          // normalizeAdapterObservation overwrites this untrusted field
          // with the Registry's startup-time allowlist decision.
          retryability: "retryable",
        });
      },
      query() {
        throw new Error("Query was not expected.");
      },
    };
    const processor = new ProviderAttemptProcessor({
      runtime: createRuntime(),
      store: {
        claimDispatch: vi
          .fn()
          .mockResolvedValue(processedClaimResult(envelope, invocationClaim())),
        markSubmissionStarted: vi.fn().mockResolvedValue(true),
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.invocation)
        .mockReturnValueOnce(ids.observation)
        .mockReturnValueOnce(ids.nextAttempt)
        .mockReturnValueOnce(ids.terminalEvent),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      run: {
        executionStatus: "observed",
        status: "failed",
      },
    });
    expect(appendAndAdoptObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        observationId: ids.observation,
        status: "failed",
        stableErrorCode: "provider.invalid_request",
        retryability: "terminal",
        upstreamError: {
          statusCode: 400,
          requestId: "tokenhub-request-123",
          body: '{"code":"invalid_request","message":"image is not allowed"}',
        },
        responseDigest: digestProviderValue({
          statusCode: 400,
          requestId: "tokenhub-request-123",
          body: '{"code":"invalid_request","message":"image is not allowed"}',
        }),
        nextAttemptId: ids.nextAttempt,
        terminalOutboxEventId: ids.terminalEvent,
      }),
    );
  });

  it("normalizes an unclassified Adapter exception to unknown without persisting raw error text", async () => {
    const envelope = providerDispatchEnvelope();
    let capturedObservation: AppendProviderObservationOptions | undefined;
    const appendAndAdoptObservation = vi.fn(
      (options: AppendProviderObservationOptions) => {
        capturedObservation = options;
        return Promise.resolve(observationAdopted());
      },
    );
    const adapter: AsyncProviderAdapter = {
      adapterKey: "fake.async.provider",
      queryMode: "client_request_id",
      notFoundIsAuthoritative: true,
      submit() {
        throw new Error("secret upstream response");
      },
      query() {
        throw new Error("Query was not expected.");
      },
    };
    const processor = new ProviderAttemptProcessor({
      runtime: createRuntime(),
      store: {
        claimDispatch: vi
          .fn()
          .mockResolvedValue(processedClaimResult(envelope, invocationClaim())),
        markSubmissionStarted: vi.fn().mockResolvedValue(true),
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.invocation)
        .mockReturnValueOnce(ids.observation),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      run: {
        executionStatus: "observed",
        status: "unknown",
      },
    });
    const persisted = requireDefined(
      capturedObservation,
      "Unclassified Provider observation",
    );
    expect(persisted).toEqual(
      expect.objectContaining({
        status: "unknown",
        stableErrorCode: "provider.adapter_unclassified",
      }),
    );
    expect(JSON.stringify(persisted)).not.toContain("secret upstream response");
  });

  it("preserves a structurally valid Adapter call error across duplicated module identities", async () => {
    const envelope = providerDispatchEnvelope();
    let capturedObservation: AppendProviderObservationOptions | undefined;
    const appendAndAdoptObservation = vi.fn(
      (options: AppendProviderObservationOptions) => {
        capturedObservation = options;
        return Promise.resolve(observationAdopted());
      },
    );
    const adapter: AsyncProviderAdapter = {
      adapterKey: "fake.async.provider",
      queryMode: "client_request_id",
      notFoundIsAuthoritative: true,
      failureRetryability: {
        "provider.response_body_invalid": "manual",
      },
      submit() {
        const error = new Error("secret upstream response");
        error.name = "ProviderAdapterCallError";
        Object.assign(error, {
          stableErrorCode: "provider.response_body_invalid",
          effect: "unknown",
          diagnosticKey: "r-n",
        });
        expect(error instanceof ProviderAdapterCallError).toBe(false);
        throw error;
      },
      query() {
        throw new Error("Query was not expected.");
      },
    };
    const processor = new ProviderAttemptProcessor({
      runtime: createRuntime(),
      store: {
        claimDispatch: vi
          .fn()
          .mockResolvedValue(processedClaimResult(envelope, invocationClaim())),
        markSubmissionStarted: vi.fn().mockResolvedValue(true),
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.invocation)
        .mockReturnValueOnce(ids.observation),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      run: {
        executionStatus: "observed",
        status: "unknown",
      },
    });
    const persisted = requireDefined(
      capturedObservation,
      "Structurally recovered Provider observation",
    );
    expect(persisted).toEqual(
      expect.objectContaining({
        status: "unknown",
        stableErrorCode: "provider.response_body_invalid",
      }),
    );
    expect(persisted.observationKey).toMatch(/:r-n$/u);
    expect(JSON.stringify(persisted)).not.toContain("secret upstream response");
  });

  it("fails an unknown Provider response closed when no safe query identity exists", async () => {
    const envelope = providerDispatchEnvelope();
    let capturedObservation: AppendProviderObservationOptions | undefined;
    const appendAndAdoptObservation = vi.fn(
      (options: AppendProviderObservationOptions) => {
        capturedObservation = options;
        return Promise.resolve(observationAdopted(true));
      },
    );
    const adapter: AsyncProviderAdapter = {
      adapterKey: "fake.async.provider",
      queryMode: "provider_request_id",
      notFoundIsAuthoritative: true,
      submit() {
        throw new Error("secret upstream response");
      },
      query() {
        throw new Error("Query was not expected.");
      },
    };
    const processor = new ProviderAttemptProcessor({
      runtime: createRuntime(),
      store: {
        claimDispatch: vi.fn().mockResolvedValue(
          processedClaimResult(
            envelope,
            invocationClaim({
              route: Object.freeze({
                ...route,
                queryMode: "provider_request_id",
              }),
            }),
          ),
        ),
        markSubmissionStarted: vi.fn().mockResolvedValue(true),
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.invocation)
        .mockReturnValueOnce(ids.observation)
        .mockReturnValueOnce(ids.nextAttempt)
        .mockReturnValueOnce(ids.terminalEvent),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      run: {
        executionStatus: "observed",
        status: "failed",
      },
    });
    const persisted = requireDefined(
      capturedObservation,
      "Unqueryable Provider observation",
    );
    expect(persisted).toEqual(
      expect.objectContaining({
        status: "failed",
        stableErrorCode: "provider.adapter_unclassified",
        retryability: "manual",
        nextAttemptId: ids.nextAttempt,
        terminalOutboxEventId: ids.terminalEvent,
      }),
    );
    expect(JSON.stringify(persisted)).not.toContain("secret upstream response");
  });

  it.each([
    {
      name: "nested undefined",
      output: () => ({
        artifactId: undefined,
      }),
    },
    {
      name: "non-plain object",
      output: () => new Date("2026-07-27T12:00:00.000Z"),
    },
    {
      name: "cyclic object",
      output: () => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      },
    },
  ])(
    "rejects a succeeded Provider output containing $name before persistence",
    async ({ output }) => {
      const envelope = providerDispatchEnvelope();
      const appendAndAdoptObservation = vi.fn();
      const adapter: AsyncProviderAdapter = {
        adapterKey: "fake.async.provider",
        queryMode: "client_request_id",
        notFoundIsAuthoritative: true,
        submit() {
          return Promise.resolve({
            observationKey: "submit:invalid-output",
            status: "succeeded",
            output: output(),
          });
        },
        query() {
          throw new Error("Query was not expected.");
        },
      };
      const processor = new ProviderAttemptProcessor({
        runtime: createRuntime(),
        store: {
          claimDispatch: vi
            .fn()
            .mockResolvedValue(
              processedClaimResult(envelope, invocationClaim()),
            ),
          markSubmissionStarted: vi.fn().mockResolvedValue(true),
          appendAndAdoptObservation,
        } as unknown as ProviderInvocationStore,
        adapters: createProviderAdapterRegistry([adapter]),
        nextId: vi
          .fn()
          .mockReturnValueOnce(ids.invocation)
          .mockReturnValueOnce(ids.observation),
        now: () => NOW,
      });

      await expect(processor.handle(envelope)).rejects.toBeInstanceOf(
        ProviderAdapterContractError,
      );
      expect(appendAndAdoptObservation).not.toHaveBeenCalled();
    },
  );

  it("maps a proven pre-submit failure to authoritative not-found without an error code", async () => {
    const envelope = providerDispatchEnvelope();
    const adapter = new FakeAsyncProviderAdapter();
    adapter.failNextAt("before_submit");
    let capturedObservation: AppendProviderObservationOptions | undefined;
    const appendAndAdoptObservation = vi.fn(
      (options: AppendProviderObservationOptions) => {
        capturedObservation = options;
        return Promise.resolve(observationAdopted(true));
      },
    );
    const processor = new ProviderAttemptProcessor({
      runtime: createRuntime(),
      store: {
        claimDispatch: vi
          .fn()
          .mockResolvedValue(processedClaimResult(envelope, invocationClaim())),
        markSubmissionStarted: vi.fn().mockResolvedValue(true),
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.invocation)
        .mockReturnValueOnce(ids.observation)
        .mockReturnValueOnce(ids.nextAttempt)
        .mockReturnValueOnce(ids.terminalEvent),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).resolves.toMatchObject({
      claimed: true,
      run: {
        executionStatus: "observed",
        status: "not_found",
      },
    });
    const observation = requireDefined(
      capturedObservation,
      "Provider not-found observation",
    );
    expect(observation).toMatchObject({
      observationId: ids.observation,
      status: "not_found",
      nextAttemptId: ids.nextAttempt,
      terminalOutboxEventId: ids.terminalEvent,
    });
    expect(
      Object.prototype.hasOwnProperty.call(observation, "stableErrorCode"),
    ).toBe(false);
    expect(adapter.stats()).toEqual({
      remoteCreateCount: 0,
      submitCallCount: 1,
      queryCallCount: 0,
    });
  });

  it.each([
    {
      name: "duplicate delivery",
      claimResult: (envelope: ProviderDispatchEnvelope) =>
        duplicateClaimResult(envelope),
      deliveryStatus: "duplicate",
    },
    {
      name: "processed delivery without a claim",
      claimResult: (envelope: ProviderDispatchEnvelope) =>
        processedClaimResult(envelope, undefined),
      deliveryStatus: "processed",
    },
  ])(
    "does no Provider I/O for $name",
    async ({ claimResult, deliveryStatus }) => {
      const envelope = providerDispatchEnvelope();
      const adapter = new FakeAsyncProviderAdapter();
      const markSubmissionStarted = vi.fn();
      const appendAndAdoptObservation = vi.fn();
      const processor = new ProviderAttemptProcessor({
        runtime: createRuntime(),
        store: {
          claimDispatch: vi.fn().mockResolvedValue(claimResult(envelope)),
          markSubmissionStarted,
          appendAndAdoptObservation,
        } as unknown as ProviderInvocationStore,
        adapters: createProviderAdapterRegistry([adapter]),
        nextId: vi.fn().mockReturnValue(ids.invocation),
        now: () => NOW,
      });

      await expect(processor.handle(envelope)).resolves.toMatchObject({
        claimed: false,
        deliveryStatus,
      });
      expect(markSubmissionStarted).not.toHaveBeenCalled();
      expect(appendAndAdoptObservation).not.toHaveBeenCalled();
      expect(adapter.stats()).toEqual({
        remoteCreateCount: 0,
        submitCallCount: 0,
        queryCallCount: 0,
      });
    },
  );

  it("leaves a remote result unadopted when the post-call fence is stale", async () => {
    const envelope = providerDispatchEnvelope();
    const fenceError = new RuntimeFenceRejectedError(
      "provider-call",
      "ACTIVE",
      "stale_execution_generation",
      "Execution generation is stale.",
    );
    const assertAllowed = vi
      .fn()
      .mockResolvedValueOnce(ACTIVE_SNAPSHOT)
      .mockResolvedValueOnce(ACTIVE_SNAPSHOT)
      .mockRejectedValueOnce(fenceError);
    const adapter = new FakeAsyncProviderAdapter();
    const appendAndAdoptObservation = vi.fn();
    const processor = new ProviderAttemptProcessor({
      runtime: createRuntime(assertAllowed),
      store: {
        claimDispatch: vi
          .fn()
          .mockResolvedValue(processedClaimResult(envelope, invocationClaim())),
        markSubmissionStarted: vi.fn().mockResolvedValue(true),
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: vi.fn().mockReturnValue(ids.invocation),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).rejects.toBe(fenceError);
    expect(adapter.stats()).toMatchObject({
      remoteCreateCount: 1,
      submitCallCount: 1,
    });
    expect(appendAndAdoptObservation).not.toHaveBeenCalled();
  });

  it("aborts remote I/O at the invocation lease deadline", async () => {
    const envelope = providerDispatchEnvelope();
    const appendAndAdoptObservation = vi.fn();
    const adapter: AsyncProviderAdapter = {
      adapterKey: "fake.async.provider",
      queryMode: "client_request_id",
      notFoundIsAuthoritative: true,
      submit(request, signal) {
        expect(request.deadlineAt).toEqual(
          new Date("2026-07-27T12:00:00.005Z"),
        );
        return new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("provider.invocation_lease_expired"),
              ),
            { once: true },
          );
        });
      },
      query() {
        throw new Error("Query was not expected.");
      },
    };
    const processor = new ProviderAttemptProcessor({
      runtime: createRuntime(),
      store: {
        claimDispatch: vi.fn().mockResolvedValue(
          processedClaimResult(
            envelope,
            invocationClaim({
              leaseExpiresAt: new Date("2026-07-27T12:00:00.005Z"),
            }),
          ),
        ),
        markSubmissionStarted: vi.fn().mockResolvedValue(true),
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: vi.fn().mockReturnValue(ids.invocation),
      now: () => NOW,
      leaseDurationMs: 5,
    });

    await expect(processor.handle(envelope)).rejects.toThrow(
      "provider.invocation_lease_expired",
    );
    expect(appendAndAdoptObservation).not.toHaveBeenCalled();
  });

  it("rejects a pinned descriptor mismatch before Adapter I/O", async () => {
    const envelope = providerDispatchEnvelope();
    const adapter = new FakeAsyncProviderAdapter();
    const markSubmissionStarted = vi.fn();
    const appendAndAdoptObservation = vi.fn();
    const mismatchedRoute = Object.freeze<ProviderRouteSnapshot>({
      ...route,
      queryMode: "provider_request_id",
    });
    const processor = new ProviderAttemptProcessor({
      runtime: createRuntime(),
      store: {
        claimDispatch: vi.fn().mockResolvedValue(
          processedClaimResult(
            envelope,
            invocationClaim({
              route: mismatchedRoute,
            }),
          ),
        ),
        markSubmissionStarted,
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      nextId: vi.fn().mockReturnValue(ids.invocation),
      now: () => NOW,
    });

    await expect(processor.handle(envelope)).rejects.toBeInstanceOf(
      ProviderAdapterContractError,
    );
    expect(markSubmissionStarted).not.toHaveBeenCalled();
    expect(appendAndAdoptObservation).not.toHaveBeenCalled();
    expect(adapter.stats()).toEqual({
      remoteCreateCount: 0,
      submitCallCount: 0,
      queryCallCount: 0,
    });
  });

  it("recovers a completed remote request through the shared query runner", async () => {
    const adapter = new FakeAsyncProviderAdapter({
      nextProviderRequestId: () => "provider-request-recovered",
    });
    const stableRequestKey = "kanvas:v1:recover-query";
    const providerOutput = {
      "😀": "emoji",
      中: "cjk",
      a: "lower",
      Z: "upper",
    };
    await adapter.submit(
      {
        route,
        stableRequestKey,
        requestFingerprint: digest("d"),
        deadlineAt: new Date("2026-07-27T12:00:30.000Z"),
        input: {
          prompt: "recover me",
        },
      },
      new AbortController().signal,
    );
    adapter.setRemoteState(route.requestScopeDigest, stableRequestKey, {
      status: "succeeded",
      output: providerOutput,
    });
    const queryClaim = invocationClaim({
      workKind: "query",
      stableRequestKey,
      requestFingerprint: digest("d"),
      providerRequestId: "provider-request-recovered",
    });
    const appendAndAdoptObservation = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("commit acknowledgement lost"), {
          code: "ECONNRESET",
        }),
      )
      .mockResolvedValue(observationAdopted(true));
    const markSubmissionStarted = vi.fn();
    const reconciler = new ProviderInvocationReconciler({
      runtime: createRuntime(),
      runtimeStateReader: createRuntimeStateReader(),
      store: {
        scanRecoveryCandidates: vi.fn().mockResolvedValue([
          {
            invocationId: ids.invocation,
            reason: "due_query",
          },
        ]),
        claimRecovery: vi.fn().mockResolvedValue(queryClaim),
        markSubmissionStarted,
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      logger: {
        error: vi.fn(),
      },
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.observation)
        .mockReturnValueOnce(ids.completion)
        .mockReturnValueOnce(ids.terminalEvent),
      now: () => NOW,
    });

    await expect(reconciler.runOnce()).resolves.toEqual({
      scanned: 1,
      claimed: 1,
      observed: 1,
      noop: 0,
      failed: 0,
    });
    expect(markSubmissionStarted).not.toHaveBeenCalled();
    expect(appendAndAdoptObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        observationId: ids.observation,
        operationKind: "query",
        source: "reconciler",
        status: "succeeded",
        providerRequestId: "provider-request-recovered",
        output: providerOutput,
        responseDigest: digestProviderValue(providerOutput),
        completionId: ids.completion,
        terminalOutboxEventId: ids.terminalEvent,
      }),
    );
    expect(appendAndAdoptObservation).toHaveBeenCalledTimes(2);
    expect(appendAndAdoptObservation.mock.calls[1]).toEqual(
      appendAndAdoptObservation.mock.calls[0],
    );
    expect(adapter.stats().queryCallCount).toBe(1);
  });

  it("logs a bounded Provider query stage and error code when its lease expires", async () => {
    const adapter: AsyncProviderAdapter = {
      adapterKey: "fake.async.provider",
      queryMode: "client_request_id",
      notFoundIsAuthoritative: true,
      submit() {
        throw new Error("Submission was not expected.");
      },
      query(_request, signal) {
        return new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(
                new ProviderAdapterCallError(
                  "provider.transport_deadline_exceeded",
                  "unknown",
                  "sensitive-output-url",
                  undefined,
                  "result_download",
                ),
              ),
            { once: true },
          );
        });
      },
    };
    const logger = { error: vi.fn() };
    const appendAndAdoptObservation = vi.fn();
    const reconciler = new ProviderInvocationReconciler({
      runtime: createRuntime(),
      runtimeStateReader: createRuntimeStateReader(),
      store: {
        scanRecoveryCandidates: vi
          .fn()
          .mockResolvedValue([
            { invocationId: ids.invocation, reason: "expired_query_lease" },
          ]),
        claimRecovery: vi.fn().mockResolvedValue(
          invocationClaim({
            workKind: "query",
            leaseExpiresAt: new Date(NOW.getTime() + 5),
          }),
        ),
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      logger,
      nextId: vi.fn().mockReturnValue(ids.observation),
      now: () => NOW,
    });

    await expect(reconciler.runOnce()).resolves.toMatchObject({
      scanned: 1,
      failed: 1,
    });
    expect(appendAndAdoptObservation).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        invocationId: ids.invocation,
        recoveryReason: "expired_query_lease",
        providerErrorCode: "provider.transport_deadline_exceeded",
        providerCallEffect: "unknown",
        providerCallStage: "result_download",
      }),
      "Provider reconciliation candidate failed; continuing.",
    );
    expect(JSON.stringify(logger.error.mock.calls[0]?.[0])).not.toContain(
      "sensitive-output-url",
    );
  });

  it.each(["cancel_deadline", "execution_deadline"] as const)(
    "settles a %s through the store without Provider I/O",
    async (reason) => {
      const adapter = new FakeAsyncProviderAdapter();
      const claimRecovery = vi.fn().mockResolvedValue(undefined);
      const reconciler = new ProviderInvocationReconciler({
        runtime: createRuntime(),
        runtimeStateReader: createRuntimeStateReader(),
        store: {
          scanRecoveryCandidates: vi.fn().mockResolvedValue([
            {
              invocationId: ids.invocation,
              reason,
            },
          ]),
          claimRecovery,
          markSubmissionStarted: vi.fn(),
          appendAndAdoptObservation: vi.fn(),
        } as unknown as ProviderInvocationStore,
        adapters: createProviderAdapterRegistry([adapter]),
        logger: {
          error: vi.fn(),
        },
        nextId: vi.fn().mockReturnValue(ids.terminalEvent),
        now: () => NOW,
      });

      await expect(reconciler.runOnce()).resolves.toEqual({
        scanned: 1,
        claimed: 0,
        observed: 0,
        noop: 1,
        failed: 0,
      });
      expect(claimRecovery).toHaveBeenCalledWith(
        expect.objectContaining({
          invocationId: ids.invocation,
          executionGeneration: 7,
          terminalOutboxEventId: ids.terminalEvent,
        }),
      );
      expect(adapter.stats()).toEqual({
        remoteCreateCount: 0,
        submitCallCount: 0,
        queryCallCount: 0,
      });
    },
  );

  it("isolates one bad recovery candidate and continues with the next", async () => {
    const adapter = new FakeAsyncProviderAdapter({
      nextProviderRequestId: () => "provider-request-healthy",
    });
    const stableRequestKey = "kanvas:v1:healthy-query";
    await adapter.submit(
      {
        route,
        stableRequestKey,
        requestFingerprint: digest("e"),
        deadlineAt: new Date("2026-07-27T12:00:30.000Z"),
        input: {},
      },
      new AbortController().signal,
    );
    adapter.setRemoteState(route.requestScopeDigest, stableRequestKey, {
      status: "succeeded",
      output: {
        artifactId: "artifact-healthy",
      },
    });
    const failedCandidate = {
      invocationId: ids.invocation,
      reason: "due_query" as const,
    };
    const healthyCandidate = {
      invocationId: ids.secondInvocation,
      reason: "due_query" as const,
    };
    const failedClaim = invocationClaim({
      workKind: "query",
      adapterKey: "missing.sensitive-adapter-name",
    });
    const healthyClaim = invocationClaim({
      workKind: "query",
      invocationId: ids.secondInvocation,
      stableRequestKey,
      requestFingerprint: digest("e"),
      providerRequestId: "provider-request-healthy",
    });
    const claimRecovery = vi.fn(
      ({ invocationId }: { readonly invocationId: string }) =>
        Promise.resolve(
          invocationId === ids.invocation ? failedClaim : healthyClaim,
        ),
    );
    const appendAndAdoptObservation = vi
      .fn()
      .mockResolvedValue(observationAdopted(true));
    const logger = {
      error: vi.fn(),
    };
    const reconciler = new ProviderInvocationReconciler({
      runtime: createRuntime(),
      runtimeStateReader: createRuntimeStateReader(),
      store: {
        scanRecoveryCandidates: vi
          .fn()
          .mockResolvedValue([failedCandidate, healthyCandidate]),
        claimRecovery,
        markSubmissionStarted: vi.fn(),
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      logger,
      nextId: vi
        .fn()
        .mockReturnValueOnce(ids.secondObservation)
        .mockReturnValueOnce(ids.secondCompletion)
        .mockReturnValueOnce(ids.secondTerminalEvent),
      now: () => NOW,
    });

    await expect(reconciler.runOnce()).resolves.toEqual({
      scanned: 2,
      claimed: 2,
      observed: 1,
      noop: 0,
      failed: 1,
    });
    expect(appendAndAdoptObservation).toHaveBeenCalledTimes(1);
    expect(adapter.stats().queryCallCount).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      {
        reconciliationKind: "provider_invocation",
        invocationId: ids.invocation,
        recoveryReason: "due_query",
        errorCode: "provider.reconciliation.candidate_failed",
        errorType: "ProviderAdapterContractError",
      },
      "Provider reconciliation candidate failed; continuing.",
    );
    expect(JSON.stringify(logger.error.mock.calls[0]?.[0])).not.toContain(
      "sensitive-adapter-name",
    );
  });

  it("allows only one of two reconcilers to adopt the same candidate", async () => {
    const adapter = new FakeAsyncProviderAdapter({
      nextProviderRequestId: () => "provider-request-dual-claim",
    });
    const stableRequestKey = "kanvas:v1:dual-claim";
    await adapter.submit(
      {
        route,
        stableRequestKey,
        requestFingerprint: digest("f"),
        deadlineAt: new Date("2026-07-27T12:00:30.000Z"),
        input: {},
      },
      new AbortController().signal,
    );
    adapter.setRemoteState(route.requestScopeDigest, stableRequestKey, {
      status: "succeeded",
      output: {
        artifactId: "artifact-dual-claim",
      },
    });
    const queryClaim = invocationClaim({
      workKind: "query",
      stableRequestKey,
      requestFingerprint: digest("f"),
      providerRequestId: "provider-request-dual-claim",
    });
    let claimed = false;
    const claimRecovery = vi.fn(async () => {
      await Promise.resolve();
      if (claimed) {
        return undefined;
      }
      claimed = true;
      return queryClaim;
    });
    const appendAndAdoptObservation = vi
      .fn()
      .mockResolvedValue(observationAdopted(true));
    const store = {
      scanRecoveryCandidates: vi.fn().mockResolvedValue([
        {
          invocationId: ids.invocation,
          reason: "due_query",
        },
      ]),
      claimRecovery,
      markSubmissionStarted: vi.fn(),
      appendAndAdoptObservation,
    } as unknown as ProviderInvocationStore;
    const nextId = vi
      .fn()
      .mockReturnValueOnce(ids.observation)
      .mockReturnValueOnce(ids.completion)
      .mockReturnValueOnce(ids.terminalEvent);
    const common = {
      runtime: createRuntime(),
      runtimeStateReader: createRuntimeStateReader(),
      store,
      adapters: createProviderAdapterRegistry([adapter]),
      logger: {
        error: vi.fn(),
      } as unknown as Logger,
      nextId,
      now: () => NOW,
    };
    const first = new ProviderInvocationReconciler(common);
    const second = new ProviderInvocationReconciler(common);

    const summaries = await Promise.all([first.runOnce(), second.runOnce()]);

    expect(
      summaries.reduce((total, summary) => total + summary.claimed, 0),
    ).toBe(1);
    expect(
      summaries.reduce((total, summary) => total + summary.observed, 0),
    ).toBe(1);
    expect(summaries.reduce((total, summary) => total + summary.noop, 0)).toBe(
      1,
    );
    expect(claimRecovery).toHaveBeenCalledTimes(2);
    expect(appendAndAdoptObservation).toHaveBeenCalledTimes(1);
    expect(adapter.stats().queryCallCount).toBe(1);
  });
});

describe("Provider ownership during slow work", () => {
  it("queries another task while one result download is still pending", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const completed: string[] = [];
    const query = vi.fn(async (request: ProviderQueryRequest) => {
      if (request.providerRequestId === "slow") await slow;
      completed.push(request.providerRequestId!);
      return {
        observationKey: `result:${request.providerRequestId}`,
        status: "succeeded" as const,
        output: { ok: true },
      };
    });
    const reconciler = new ProviderInvocationReconciler({
      runtime: createRuntime(),
      runtimeStateReader: createRuntimeStateReader(),
      store: {
        scanRecoveryCandidates: () =>
          Promise.resolve([
            { invocationId: ids.invocation, reason: "due_query" },
            { invocationId: ids.secondInvocation, reason: "due_query" },
          ]),
        claimRecovery: ({ invocationId }: { invocationId: string }) =>
          Promise.resolve(
            invocationClaim({
              invocationId,
              workKind: "query",
              providerRequestId:
                invocationId === ids.invocation ? "slow" : "fast",
            }),
          ),
        appendAndAdoptObservation: () =>
          Promise.resolve(observationAdopted(true)),
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([
        {
          adapterKey: "fake.async.provider",
          queryMode: route.queryMode,
          notFoundIsAuthoritative: true,
          submit: vi.fn(),
          query,
        },
      ]),
      logger: { error: vi.fn() },
      nextId: () => ids.observation,
      now: () => NOW,
      concurrency: 2,
    });
    const pending = reconciler.runOnce();
    try {
      await vi.waitFor(() => expect(completed).toEqual(["fast"]));
    } finally {
      release();
    }
    await expect(pending).resolves.toMatchObject({ observed: 2, failed: 0 });
    expect(completed).toEqual(["fast", "slow"]);
  });
  it.each([true, false])(
    "renews the existing invocation and aborts on lost ownership (%s)",
    async (keepLease) => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      try {
        const append = vi.fn().mockResolvedValue({
          recorded: true,
          adoption: "applied",
          terminal: true,
        });
        const renew = vi.fn((options: { leaseUntil: Date }) =>
          Promise.resolve(keepLease ? options.leaseUntil : undefined),
        );
        const query = vi.fn(
          (request: ProviderQueryRequest, signal: AbortSignal) => {
            expect(request.deadlineAt).toEqual(new Date(NOW.getTime() + 100));
            return new Promise<ProviderObservation>((resolve, reject) => {
              const timer = setTimeout(
                () =>
                  resolve({
                    observationKey: "slow-result",
                    status: "succeeded",
                    output: { ok: true },
                  }),
                80,
              );
              signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  reject(new Error("ownership lost"));
                },
                { once: true },
              );
            });
          },
        );
        const runner = new ProviderInvocationRunner({
          runtime: createRuntime(),
          store: {
            renewLease: renew,
            appendAndAdoptObservation: append,
          } as unknown as ProviderInvocationStore,
          adapters: createProviderAdapterRegistry([
            {
              adapterKey: "fake.async.provider",
              queryMode: route.queryMode,
              notFoundIsAuthoritative: route.notFoundIsAuthoritative,
              submit: vi.fn(),
              query,
            },
          ]),
          nextId: () => ulid("999"),
        });
        const run = runner.run({
          claim: invocationClaim({
            workKind: "query",
            leaseExpiresAt: new Date(NOW.getTime() + 30),
            executionDeadlineAt: new Date(NOW.getTime() + 100),
          }),
          leaseTokenHash: "a".repeat(64),
          source: "reconciler",
        });
        const check = keepLease
          ? expect(run).resolves.toMatchObject({ status: "succeeded" })
          : expect(run).rejects.toThrow("ownership lost");
        await vi.advanceTimersByTimeAsync(90);
        await check;
        expect(query).toHaveBeenCalledOnce();
        expect(renew).toHaveBeenCalled();
        expect(append).toHaveBeenCalledTimes(keepLease ? 1 : 0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
