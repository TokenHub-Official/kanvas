import type { ProviderRouteSnapshot } from "@kanvas/application";
import { describe, expect, it } from "vitest";

import { FakeAsyncProviderAdapter } from "../src/provider/fake-async-provider.js";
import {
  ProviderAdapterCallError,
  ProviderAdapterContractError,
  createProviderAdapterRegistry,
} from "../src/provider/provider-adapter.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const route = Object.freeze<ProviderRouteSnapshot>({
  providerProtocolVersion: 1,
  providerKey: "fake",
  apiSurface: "async-test",
  providerEndpointId: "01K00000000000000000000001",
  credentialIdentityId: "01K00000000000000000000002",
  credentialIdentityEpoch: 1,
  modelDeploymentId: "01K00000000000000000000003",
  pricingRevisionId: "01K00000000000000000000004",
  pinnedSecretVersionId: "01K00000000000000000000005",
  credentialIdentityDigest: digest("c"),
  instancePolicyRevisionId: "01K00000000000000000000006",
  workspacePolicyRevisionId: "01K00000000000000000000007",
  routePolicyRevisionId: "01K00000000000000000000008",
  modelProfileRevisionId: "01K00000000000000000000009",
  budgetAccountId: "01K00000000000000000000010",
  routingMode: "kanvas_fixed",
  executionTransparency: "full",
  maximumCharge: Object.freeze({ currencyCode: "USD", amount: "1" }),
  routeCandidateDigest: digest("a"),
  requestScopeDigest: digest("b"),
  queryMode: "client_request_id",
  notFoundIsAuthoritative: true,
});

const request = Object.freeze({
  route,
  stableRequestKey: "kanvas:v1:attempt-1",
  requestFingerprint: digest("c"),
  deadlineAt: new Date("2026-07-27T12:00:30.000Z"),
  input: {
    prompt: "test",
  },
});

describe("FakeAsyncProviderAdapter", () => {
  it("deduplicates a repeated stable request without hiding transport calls", async () => {
    const adapter = new FakeAsyncProviderAdapter({
      nextProviderRequestId: () => "provider-request-1",
    });
    const signal = new AbortController().signal;

    const first = await adapter.submit(request, signal);
    const replay = await adapter.submit(request, signal);

    expect(first.providerRequestId).toBe("provider-request-1");
    expect(replay.providerRequestId).toBe("provider-request-1");
    expect(adapter.stats()).toEqual({
      remoteCreateCount: 1,
      submitCallCount: 2,
      queryCallCount: 0,
    });
  });

  it("rejects the same stable key with a different fingerprint", async () => {
    const adapter = new FakeAsyncProviderAdapter();
    const signal = new AbortController().signal;
    await adapter.submit(request, signal);

    await expect(
      adapter.submit(
        {
          ...request,
          requestFingerprint: digest("d"),
        },
        signal,
      ),
    ).rejects.toBeInstanceOf(ProviderAdapterContractError);
    expect(adapter.stats().remoteCreateCount).toBe(1);
  });

  it("recovers an accepted-before-response crash by querying the stable key", async () => {
    const adapter = new FakeAsyncProviderAdapter({
      nextProviderRequestId: () => "provider-request-unknown",
    });
    const signal = new AbortController().signal;
    adapter.failNextAt("after_accept_before_response");

    await expect(adapter.submit(request, signal)).rejects.toMatchObject({
      stableErrorCode: "fake.after_accept_before_response",
      effect: "unknown",
    });
    await expect(adapter.query(request, signal)).resolves.toMatchObject({
      status: "running",
      providerRequestId: "provider-request-unknown",
    });
    expect(adapter.stats()).toEqual({
      remoteCreateCount: 1,
      submitCallCount: 1,
      queryCallCount: 1,
    });
  });

  it("distinguishes a failure before submit from an unknown effect", async () => {
    const adapter = new FakeAsyncProviderAdapter();
    const signal = new AbortController().signal;
    adapter.failNextAt("before_submit");

    await expect(adapter.submit(request, signal)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProviderAdapterCallError &&
        error.effect === "not_started",
    );
    await expect(adapter.query(request, signal)).resolves.toMatchObject({
      status: "not_found",
    });
    expect(adapter.stats().remoteCreateCount).toBe(0);
  });

  it("rejects duplicate adapter keys and missing registrations", () => {
    const adapter = new FakeAsyncProviderAdapter();
    const registry = createProviderAdapterRegistry([adapter]);
    expect(
      registry.classifyFailure(adapter.adapterKey, "fake.remote_failed"),
    ).toBe("retryable");
    expect(
      registry.classifyFailure(adapter.adapterKey, "fake.unclassified"),
    ).toBe("manual");
    expect(() => createProviderAdapterRegistry([adapter, adapter])).toThrow(
      /Duplicate provider adapter key/u,
    );
    expect(() =>
      createProviderAdapterRegistry([]).require(adapter.adapterKey),
    ).toThrow(/not registered/u);
  });
});
