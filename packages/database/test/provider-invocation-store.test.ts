import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  createProviderInvocationStore,
  providerExecutionDeadlineDisposition,
  ProviderInvocationStoreError,
} from "../src/runtime/provider-invocation-store.js";

describe("ProviderInvocationStore validation and recovery scan", () => {
  it("keeps Provider dispatch claiming closed unless explicitly enabled", async () => {
    const getConnection = vi.fn();
    const store = createProviderInvocationStore(
      {
        getConnection,
      } as unknown as Pool,
      {
        instanceId: "kanvas-test",
      },
    );
    const now = new Date("2026-07-27T21:00:00.000Z");

    await expect(
      store.claimDispatch({
        invocationId: "01K00000000000000000000001",
        capabilityRunId: "01K00000000000000000000002",
        attemptId: "01K00000000000000000000003",
        leaseTokenHash: "a".repeat(64),
        now,
        leaseUntil: new Date(now.getTime() + 30_000),
        executionGeneration: 1,
        delivery: {
          consumerName: "provider-attempt-dispatch.v1",
          eventId: "01K00000000000000000000004",
          workspaceId: "01K00000000000000000000005",
          messageType: "attempt.dispatch.requested",
          schemaVersion: 1,
          aggregateType: "capability_attempt",
          aggregateId: "01K00000000000000000000003",
          aggregateVersion: 1,
          expectedGeneration: 1,
          receivedAt: now,
        },
      }),
    ).rejects.toMatchObject({
      code: "provider_invocation.claiming_disabled",
    });
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("returns a bounded deterministic recovery candidate projection", async () => {
    const query = vi.fn().mockResolvedValue([
      [
        {
          invocationId: "01K00000000000000000000001",
          reason: "expired_submit_lease",
        },
        {
          invocationId: "01K00000000000000000000002",
          reason: "due_query",
        },
        {
          invocationId: "01K00000000000000000000003",
          reason: "execution_deadline",
        },
      ],
    ]);
    const store = createProviderInvocationStore(
      {
        query,
      } as unknown as Pool,
      {
        instanceId: "kanvas-test",
      },
    );
    const now = new Date("2026-07-27T21:00:00.000Z");

    await expect(
      store.scanRecoveryCandidates({
        now,
        batchSize: 20,
      }),
    ).resolves.toEqual([
      {
        invocationId: "01K00000000000000000000001",
        reason: "expired_submit_lease",
      },
      {
        invocationId: "01K00000000000000000000002",
        reason: "due_query",
      },
      {
        invocationId: "01K00000000000000000000003",
        reason: "execution_deadline",
      },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("attempt.execution_deadline_at <= ?"),
      [now, now, now, now, now, now, 20],
    );
  });

  it("fails closed at the execution deadline without inventing remote state", () => {
    expect(
      providerExecutionDeadlineDisposition({
        remoteStatus: "prepared",
        sideEffectState: "not_started",
        submissionStartedAt: null,
        notFoundIsAuthoritative: true,
      }),
    ).toEqual({
      invocationRemoteStatus: "not_found",
      invocationSideEffectState: "not_started",
      invocationWorkState: "terminal",
      attemptLifecycleStatus: "failed",
      attemptRetryDisposition: "terminal",
    });
    expect(
      providerExecutionDeadlineDisposition({
        remoteStatus: "running",
        sideEffectState: "started",
        submissionStartedAt: new Date("2026-07-27T20:59:00.000Z"),
        notFoundIsAuthoritative: false,
      }),
    ).toEqual({
      invocationRemoteStatus: "unknown",
      invocationSideEffectState: "unknown",
      invocationWorkState: "manual",
      attemptLifecycleStatus: "abandoned",
      attemptRetryDisposition: "manual",
    });
    expect(
      providerExecutionDeadlineDisposition({
        remoteStatus: "prepared",
        sideEffectState: "not_started",
        submissionStartedAt: null,
        notFoundIsAuthoritative: false,
      }),
    ).toEqual({
      invocationRemoteStatus: "failed",
      invocationSideEffectState: "not_started",
      invocationWorkState: "terminal",
      attemptLifecycleStatus: "failed",
      attemptRetryDisposition: "terminal",
    });
  });

  it("rejects unsafe lease facts before opening a transaction", async () => {
    const getConnection = vi.fn();
    const store = createProviderInvocationStore(
      {
        getConnection,
      } as unknown as Pool,
      {
        instanceId: "kanvas-test",
      },
    );

    await expect(
      store.claimRecovery({
        invocationId: "01K00000000000000000000001",
        leaseTokenHash: "not-a-hash",
        now: new Date("2026-07-27T21:00:00.000Z"),
        leaseUntil: new Date("2026-07-27T21:01:00.000Z"),
        executionGeneration: 1,
      }),
    ).rejects.toBeInstanceOf(ProviderInvocationStoreError);
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("rejects raw or inconsistent observation shapes before persistence", async () => {
    const getConnection = vi.fn();
    const store = createProviderInvocationStore(
      {
        getConnection,
      } as unknown as Pool,
      {
        instanceId: "kanvas-test",
      },
    );
    const at = new Date("2026-07-27T21:00:00.000Z");

    await expect(
      store.appendAndAdoptObservation({
        observationId: "01K00000000000000000000001",
        observationKey: "query:1",
        invocationId: "01K00000000000000000000002",
        capabilityRunId: "01K00000000000000000000003",
        attemptId: "01K00000000000000000000004",
        leaseTokenHash: "a".repeat(64),
        leaseGeneration: 1,
        executionGeneration: 1,
        operationKind: "query",
        source: "adapter",
        status: "unknown",
        observedAt: at,
        recordedAt: at,
      } as never),
    ).rejects.toMatchObject({
      code: "provider_invocation.invalid_argument",
    });

    await expect(
      store.appendAndAdoptObservation({
        observationId: "01K00000000000000000000001",
        observationKey: "query:failed",
        invocationId: "01K00000000000000000000002",
        capabilityRunId: "01K00000000000000000000003",
        attemptId: "01K00000000000000000000004",
        leaseTokenHash: "a".repeat(64),
        leaseGeneration: 1,
        executionGeneration: 1,
        operationKind: "query",
        source: "adapter",
        status: "failed",
        stableErrorCode: "provider.invalid_request",
        nextAttemptId: "01K00000000000000000000005",
        terminalOutboxEventId: "01K00000000000000000000006",
        observedAt: at,
        recordedAt: at,
      } as never),
    ).rejects.toMatchObject({
      code: "provider_invocation.invalid_argument",
    });
    expect(getConnection).not.toHaveBeenCalled();
  });
});
